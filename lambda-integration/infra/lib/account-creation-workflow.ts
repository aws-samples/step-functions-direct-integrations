/* eslint-disable @typescript-eslint/no-unsafe-argument */
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
import { Alarm, ComparisonOperator, Metric, Unit } from '@aws-cdk/aws-cloudwatch';
import { Table } from '@aws-cdk/aws-dynamodb';
import { Effect, PolicyStatement } from '@aws-cdk/aws-iam';
import { Code, Function, LayerVersion, Runtime, Tracing } from '@aws-cdk/aws-lambda';
import { PythonFunction } from '@aws-cdk/aws-lambda-python/';
import { RetentionDays } from '@aws-cdk/aws-logs';
import { Bucket } from '@aws-cdk/aws-s3';
import { IChainable, Parallel, Pass, Fail } from '@aws-cdk/aws-stepfunctions';
import { LambdaInvocationType, LambdaInvoke } from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration, Stack } from '@aws-cdk/core';
import { LambdaToEventbridge } from '@aws-solutions-constructs/aws-lambda-eventbridge';
import { LambdaToSqs } from '@aws-solutions-constructs/aws-lambda-sqs';

export interface AccountCreationWorkflowProps {
  readonly uploadBucket: Bucket;
  readonly userTable: Table;
  readonly notifyLambda: PythonFunction;
}

const SERVICE_NAME = 'BankAccountCreation';

export class AccountCreationWorkflow extends Construct {
  public readonly definition: IChainable;

  constructor(scope: Construct, id: string, props: AccountCreationWorkflowProps) {
    super(scope, id);

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

    const validateIdentityLambda = new PythonFunction(this, 'validateIdentity', {
      entry: 'functions/verifyIdentity/',
      handler: 'index.handler',
      runtime: Runtime.PYTHON_3_9,
      description: 'Function that validates identity against ID card',
      environment: {
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: SERVICE_NAME,
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      layers: [powertoolsLayer],
    });

    const validateAddressLambda = new PythonFunction(this, 'validateAddress', {
      entry: 'functions/verifyAddress/src',
      description: 'Function that validates a postal address',
      runtime: Runtime.PYTHON_3_9,
      environment: {
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: SERVICE_NAME,
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
        CONFIDENCE_THRESHOLD: '0.82',
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(30),
      memorySize: 256,
      layers: [powertoolsLayer],
    });

    const checkExistingUserLambda = new PythonFunction(this, 'checkExistingUser', {
      entry: 'functions/checkExistingUser/',
      handler: 'index.handler',
      runtime: Runtime.PYTHON_3_9,
      description: 'Function that checks if a user already exists in database',
      environment: {
        USER_TABLE: props.userTable.tableName,
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: SERVICE_NAME,
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      layers: [powertoolsLayer],
    });
    props.userTable.grant(checkExistingUserLambda, 'dynamodb:Query');

    const createUserLambda = new PythonFunction(this, 'createUser', {
      entry: 'functions/createUser/',
      runtime: Runtime.PYTHON_3_9,
      description: 'Function that create user in database',
      environment: {
        USER_TABLE: props.userTable.tableName,
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: SERVICE_NAME,
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      layers: [powertoolsLayer],
    });
    props.userTable.grant(createUserLambda, 'dynamodb:DescribeTable', 'dynamodb:PutItem');

    const sendToDLQLambda = new PythonFunction(this, 'sendToDLQ', {
      entry: 'functions/sendToDLQ/',
      handler: 'index.handler',
      runtime: Runtime.PYTHON_3_9,
      description: 'Function that send information to the DLQ in case of error',
      environment: {
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: SERVICE_NAME,
        POWERTOOLS_METRICS_NAMESPACE: SERVICE_NAME,
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      layers: [powertoolsLayer],
    });

    const dlq = new LambdaToSqs(this, 'deadLetterQueue', {
      deployDeadLetterQueue: false, // this is the dlq
      existingLambdaObj: sendToDLQLambda,
    });

    new Alarm(this, 'AlarmDLQ', {
      metric: dlq.sqsQueue.metric('NumberOfMessagesSent', {
        statistic: 'sum',
        unit: Unit.COUNT,
      }),
      threshold: 10,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    new Alarm(this, 'AlarmDLQError', {
      metric: new Metric({
        namespace: 'SERVICE_NAME',
        metricName: 'ErrorSendingToDLQ',
        statistic: 'sum',
        unit: Unit.COUNT,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    const notifyBackendLambda = new Function(this, 'notifyBackends', {
      code: Code.fromAsset('functions/notifyBackends/'),
      handler: 'index.handler',
      runtime: Runtime.PYTHON_3_9,
      description: 'Function that send an event "User Created" to backends',
      environment: {
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: SERVICE_NAME,
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      layers: [powertoolsLayer],
    });

    new LambdaToEventbridge(this, 'userEventBus', {
      existingLambdaObj: notifyBackendLambda,
      eventBusProps: {
        eventBusName: 'userEventBus',
      },
    });

    // WORKFLOW STATES DEFINITION

    const identityCheckFail = new Fail(this, 'Account creation failed, incorrect identity');
    const addressCheckFail = new Fail(this, 'Account creation failed, incorrect address');

    const notifyIdError = new LambdaInvoke(this, 'Inform User of an identity error', {
      lambdaFunction: props.notifyLambda,
    });
    const notifyAddressError = new LambdaInvoke(this, 'Inform User of an address error', {
      lambdaFunction: props.notifyLambda,
    });

    const idErrorToJson = new Pass(this, 'Convert Identity Error Cause to JSON', {
      parameters: {
        'connectionId.$': '$.connectionId',
        'error.$': 'States.StringToJson($.error.Cause)',
      },
    })
      .next(notifyIdError)
      .next(identityCheckFail);

    const addressErrorToJson = new Pass(this, 'Convert Address Error Cause to JSON', {
      parameters: {
        'connectionId.$': '$.connectionId',
        'error.$': 'States.StringToJson($.error.Cause)',
      },
    })
      .next(notifyAddressError)
      .next(addressCheckFail);

    const sendIdCardToDLQ = new LambdaInvoke(this, 'Send ID Card to DLQ', {
      lambdaFunction: dlq.lambdaFunction,
      invocationType: LambdaInvocationType.EVENT,
    }).next(notifyIdError);

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

    const checkId = new LambdaInvoke(this, 'Crosscheck Identity', {
      lambdaFunction: validateIdentityLambda,
      // resultSelector: {"valid.$":"$.Payload"},
      // resultPath: "$.validation.idcard"
      outputPath: '$.Payload',
    });
    checkId.addCatch(idErrorToJson, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const checkExistingUser = new LambdaInvoke(this, 'Check user exists', {
      lambdaFunction: checkExistingUserLambda,
      // resultSelector: {"exists.$":"$.Payload"},
      // resultPath: "$.validation.user"
      outputPath: '$.Payload',
    });
    checkExistingUser.addCatch(idErrorToJson, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const validateAddress = new LambdaInvoke(this, 'Validate Address', {
      lambdaFunction: validateAddressLambda,
      // resultSelector: {"address.$":"$.Payload"},
      // resultPath: "$.validation.address"
      outputPath: '$.Payload',
    });
    validateAddress.addRetry({
      errors: ['Request Error'],
    });
    validateAddress.addCatch(addressErrorToJson, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const createUser = new LambdaInvoke(this, 'Create User', {
      lambdaFunction: createUserLambda,
      outputPath: '$.Payload',
    });

    const notifyBackends = new LambdaInvoke(this, 'Notify Backends', {
      lambdaFunction: notifyBackendLambda,
      outputPath: '$.Payload',
    });

    const notifySucess = new LambdaInvoke(this, 'Inform User of success', {
      lambdaFunction: props.notifyLambda,
    });

    const inputChecks = new Parallel(this, 'Input checks', {
      resultSelector: {
        'user.$': '$[1]',
      },
    });

    // WORKFLOW DEFINITION

    this.definition = inputChecks
      .branch(extractInfoFromIdCard.next(checkId).next(checkExistingUser))
      .branch(validateAddress)
      .next(createUser)
      .next(new Parallel(this, 'notifications').branch(notifyBackends).branch(notifySucess));
  }
}
