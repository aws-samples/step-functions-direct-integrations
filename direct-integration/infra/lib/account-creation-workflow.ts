/**
 * Copyright 2022 Amazon Web Services (AWS)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.

 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { HttpApi, HttpMethod as HTTPMethod } from '@aws-cdk/aws-apigatewayv2-alpha';
import { HttpUrlIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { Stack, Duration, CfnOutput } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, Unit } from 'aws-cdk-lib/aws-cloudwatch';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Effect, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LayerVersion, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import {
  Condition,
  Parallel,
  Pass,
  Fail,
  StateMachine,
  LogLevel,
  TaskInput,
  Choice,
  JsonPath,
  IChainable,
  StateMachineType,
  Succeed,
  CfnStateMachine,
} from 'aws-cdk-lib/aws-stepfunctions';
import {
  CallAwsService,
  EventBridgePutEvents,
  DynamoPutItem,
  DynamoAttributeValue,
  SqsSendMessage,
  LambdaInvoke,
  CallApiGatewayHttpApiEndpointProps,
  CallApiGatewayHttpApiEndpoint,
  HttpMethod,
} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface AccountCreationWorkflowProps {
  readonly uploadBucket: Bucket;
  readonly userTable: Table;
  readonly userEventBus: EventBus;
}

const SERVICE_NAME = 'DirectBankAccountCreation';

export class AccountCreationWorkflow extends Construct {
  public stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: AccountCreationWorkflowProps) {
    super(scope, id);

    const idCardExtraction = this.idCardExtraction(props);

    const identityValidation = this.identityValidation(props);

    const addressValidation = this.addressValidation();

    const userCreation = this.userCreation(props);

    const backendsNotification = this.backendsNotification(props);

    this.stateMachineCreation(idCardExtraction, identityValidation, addressValidation, userCreation, backendsNotification, props);
  }

  private idCardExtraction(props: AccountCreationWorkflowProps): LambdaInvoke {
    const deadLetterQueue = new Queue(this, 'deadLetterQueue');

    const sendIdCardToDLQ = new SqsSendMessage(this, 'Send ID Card to DLQ', {
      queue: deadLetterQueue,
      messageBody: TaskInput.fromObject({
        requestId: JsonPath.stringAt('$.requestId'),
        idcard: JsonPath.stringAt('$.idcard'),
        error: JsonPath.stringAt('$.error.Cause'),
      }),
    }).next(
      new Fail(this, 'Cannot extract information from ID card', {
        error: 'IdentityExtractionError',
        cause: 'Cannot extract information from the provided ID card',
      }),
    );

    new Alarm(this, 'AlarmDLQ', {
      metric: deadLetterQueue.metric('NumberOfMessagesSent', {
        statistic: 'sum',
        unit: Unit.COUNT,
      }),
      threshold: 10,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    const powertoolsLayer = LayerVersion.fromLayerVersionArn(
      this,
      'powertools-python',
      `arn:aws:lambda:${Stack.of(this).region}:017000801446:layer:AWSLambdaPowertoolsPython:3`,
    );

    const extractInfoFromIdCardLambda = new PythonFunction(this, 'extractInfoFromIdCard', {
      entry: 'functions/extractInfoFromIdCard/src',
      description: 'Function that extracts information from an ID card image',
      runtime: Runtime.PYTHON_3_9,
      environment: {
        UPLOAD_BUCKET: props.uploadBucket.bucketName,
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: SERVICE_NAME,
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(30),
      memorySize: 256,
      layers: [powertoolsLayer],
    });

    props.uploadBucket.grantRead(extractInfoFromIdCardLambda);

    extractInfoFromIdCardLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['textract:AnalyzeDocument'],
        resources: ['*'],
      }),
    );

    const extractInfoFromIdCard = new LambdaInvoke(this, 'Extract info from ID', {
      lambdaFunction: extractInfoFromIdCardLambda,
      resultSelector: {
        'firstname.$': '$.Payload.firstnames[0]',
        'lastname.$': '$.Payload.lastname',
        'birthdate.$': '$.Payload.birthdate',
      },
      resultPath: '$.identity',
    });
    extractInfoFromIdCard.addCatch(sendIdCardToDLQ, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
    return extractInfoFromIdCard;
  }

  private addressValidation() {
    const addressIntegration = new HttpUrlIntegration('AddressSearch', 'https://api-adresse.data.gouv.fr/search/');

    const httpApi = new HttpApi(this, 'AddressHttpApi');

    httpApi.addRoutes({
      path: '/search',
      methods: [HTTPMethod.GET],
      integration: addressIntegration,
    });

    const apiCallProps: CallApiGatewayHttpApiEndpointProps = {
      apiId: httpApi.apiId,
      apiStack: Stack.of(httpApi),
      method: HttpMethod.GET,
      apiPath: '/search',
      queryParameters: TaskInput.fromObject({
        'q.$': 'States.Array($.street)',
        'postcode.$': 'States.Array($.postalcode)',
        autocomplete: ['0'],
        limit: ['1'],
      }),
      resultSelector: {
        'result.$': '$.ResponseBody.features',
      },
      resultPath: '$.addresscheck',
    };

    return new CallApiGatewayHttpApiEndpoint(this, 'Validate Address', apiCallProps).addRetry().next(
      new Choice(this, 'Is Address Valid')
        .when(
          Condition.and(
            Condition.isPresent('$.addresscheck.result[0]'),
            Condition.isPresent('$.addresscheck.result[0].properties'),
            Condition.isPresent('$.addresscheck.result[0].properties.score'),
            Condition.numberGreaterThan('$.addresscheck.result[0].properties.score', 0.82),
          ),
          new Pass(this, 'Reformat Address', {
            parameters: {
              'userId.$': '$.requestId',
              'firstname.$': '$.firstname',
              'lastname.$': '$.lastname',
              'birthdate.$': '$.birthdate',
              'countrybirth.$': '$.countrybirth',
              'address.$': '$.addresscheck.result[0].properties.label',
              'country.$': '$.country',
              'email.$': '$.email',
              'idcard.$': '$.idcard',
            },
          }),
        )
        .otherwise(
          new Fail(this, 'Address is incorrect', {
            error: 'AddressInvalid',
            cause: 'Address could not be validated',
          }),
        ),
    );
  }

  private identityValidation(props: AccountCreationWorkflowProps) {
    const getUserIfExist = new CallAwsService(this, 'Get User if exists', {
      service: 'dynamodb',
      action: 'query',
      iamResources: [props.userTable.tableArn],
      parameters: {
        TableName: props.userTable.tableName,
        IndexName: 'fullname',
        Select: 'SPECIFIC_ATTRIBUTES',
        ProjectionExpression: 'id',
        KeyConditionExpression: 'lastname = :ln AND firstname = :fn',
        ExpressionAttributeValues: {
          ':ln': {
            S: JsonPath.stringAt('$.lastname'),
          },
          ':fn': {
            S: JsonPath.stringAt('$.firstname'),
          },
        },
      },
      resultPath: '$.userexists',
    });

    const checkUserExist = new Choice(this, 'Check user exists')
      .when(
        Condition.numberGreaterThan('$.userexists.Count', 0),
        new Fail(this, 'User already exists', {
          error: 'UserAlreadyExists',
          cause: 'A user with the same full name already exists',
        }),
      )
      .otherwise(new Pass(this, 'User does not exist'));

    const checkId = new Choice(this, 'Crosscheck Identity')
      .when(
        Condition.not(Condition.stringEqualsJsonPath('$.firstname', '$.identity.firstname')),
        new Fail(this, 'Firstname does not match with ID card', {
          error: 'UnmatchedIdentity',
          cause: 'Provided firstname does not match with ID card firstname',
        }),
      )
      .when(
        Condition.not(Condition.stringEqualsJsonPath('$.lastname', '$.identity.lastname')),
        new Fail(this, 'Lastname does not match with ID card', {
          error: 'UnmatchedIdentity',
          cause: 'Provided lastname does not match with ID card lastname',
        }),
      )
      .when(
        Condition.not(Condition.stringEqualsJsonPath('$.birthdate', '$.identity.birthdate')),
        new Fail(this, 'Birthdate does not match with ID card', {
          error: 'UnmatchedIdentity',
          cause: 'Provided birthdate does not match with ID card birthdate',
        }),
      )
      .otherwise(getUserIfExist.next(checkUserExist));
    return checkId;
  }

  private userCreation(props: AccountCreationWorkflowProps) {
    return new DynamoPutItem(this, 'Create User', {
      table: props.userTable,
      item: {
        id: DynamoAttributeValue.fromString(JsonPath.stringAt('$.user.userId')),
        firstname: DynamoAttributeValue.fromString(JsonPath.stringAt('$.user.firstname')),
        lastname: DynamoAttributeValue.fromString(JsonPath.stringAt('$.user.lastname')),
        birthdate: DynamoAttributeValue.fromString(JsonPath.stringAt('$.user.birthdate')),
        birthcountry: DynamoAttributeValue.fromString(JsonPath.stringAt('$.user.countrybirth')),
        address: DynamoAttributeValue.fromString(JsonPath.stringAt('$.user.address')),
        country: DynamoAttributeValue.fromString(JsonPath.stringAt('$.user.country')),
        email: DynamoAttributeValue.fromString(JsonPath.stringAt('$.user.email')),
        idcardref: DynamoAttributeValue.fromString(JsonPath.stringAt('$.user.idcard')),
      },
      resultPath: JsonPath.DISCARD,
    });
  }

  private backendsNotification(props: AccountCreationWorkflowProps) {
    return new EventBridgePutEvents(this, 'Notify Backends', {
      entries: [
        {
          detail: TaskInput.fromJsonPathAt('$.user'),
          eventBus: props.userEventBus,
          detailType: 'UserCreated',
          source: 'user',
        },
      ],
      resultPath: JsonPath.DISCARD,
    });
  }

  private stateMachineCreation(
    extractInfoFromIdCard: LambdaInvoke,
    checkId: Choice,
    validateAddress: IChainable,
    createUser: DynamoPutItem,
    notifyBackends: EventBridgePutEvents,
    props: AccountCreationWorkflowProps,
  ) {
    const definition = new Parallel(this, 'Input checks', {
      resultSelector: {
        'user.$': '$[1]',
      },
    })
      .branch(extractInfoFromIdCard.next(checkId))
      .branch(validateAddress)
      .next(createUser)
      .next(notifyBackends)
      .next(
        new Pass(this, 'Reformat result', {
          parameters: {
            'userId.$': '$.user.userId',
          },
        }),
      )
      .next(new Succeed(this, 'User created, account creation initiated'));

    const logGroup = new LogGroup(this, 'accountCreationWorkflowLogs', {
      retention: RetentionDays.ONE_WEEK,
    });

    const stateMachineRole = new Role(this, 'accountCreationWorkflowRole', {
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
    });

    stateMachineRole.attachInlinePolicy(
      new Policy(this, 'ReadWriteDynamoDB', {
        statements: [
          new PolicyStatement({
            actions: ['dynamodb:Query', 'dynamodb:PutItem'],
            effect: Effect.ALLOW,
            resources: [props.userTable.tableArn, props.userTable.tableArn + '/index/*'],
          }),
        ],
      }),
    );

    this.stateMachine = new StateMachine(this, 'accountCreationWorkflow', {
      definition: definition,
      logs: {
        destination: logGroup,
        includeExecutionData: true,
        level: LogLevel.ALL,
      },
      tracingEnabled: true,
      stateMachineType: StateMachineType.EXPRESS,
      role: stateMachineRole,
    });

    const statemachine = this.stateMachine.node.defaultChild as CfnStateMachine;
    if (statemachine.definitionString) {
      new CfnOutput(this, 'StateMachineDefinition', {
        description: 'State Machine Definition',
        value: statemachine.definitionString,
      });
    }
  }
}
