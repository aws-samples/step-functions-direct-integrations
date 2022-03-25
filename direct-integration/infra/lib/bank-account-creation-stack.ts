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
import { Stack, StackProps } from 'aws-cdk-lib';
import {
  AwsIntegration,
  IntegrationResponse,
  MethodResponse,
  RestApi,
  JsonSchemaVersion,
  JsonSchemaType,
  PassthroughBehavior,
  RequestValidator,
} from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Effect, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { AccountCreationWorkflow } from './account-creation-workflow';
import { S3UploadPresignedUrlAPI } from './s3-upload-presigned-url-api';

export class BankAccountCreationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Parameters (using context)
    const allowedOrigins: string = this.node.tryGetContext('origins') || '*';
    const origins: string[] = allowedOrigins.split(',');

    const expiration: number = this.node.tryGetContext('expiration') || 300;

    const userCreationAPI = new S3UploadPresignedUrlAPI(this, 'userCreationAPI', {
      allowedOrigins: origins,
      expiration: expiration,
    });

    const userTable = new Table(this, 'userTable', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      sortKey: { name: 'lastname', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });
    userTable.addGlobalSecondaryIndex({
      indexName: 'fullname',
      partitionKey: { name: 'lastname', type: AttributeType.STRING },
      sortKey: { name: 'firstname', type: AttributeType.STRING },
    });

    const eventBus = new EventBus(this, 'userEventBus', { eventBusName: 'userEventBusDirect' });

    const workflow = new AccountCreationWorkflow(this, 'workflow', {
      uploadBucket: userCreationAPI.uploadBucket,
      userTable: userTable,
      userEventBus: eventBus,
    });

    this.apiToWorklow(allowedOrigins, userCreationAPI, workflow);
  }

  private apiToWorklow(allowedOrigins: string, userCreationAPI: S3UploadPresignedUrlAPI, workflow: AccountCreationWorkflow) {
    const corsIntegResponseParameters = {
      'method.response.header.Access-Control-Allow-Headers': "'Authorization, *'",
      'method.response.header.Access-Control-Allow-Methods': "'POST, OPTIONS'",
      'method.response.header.Access-Control-Allow-Origin': "'" + allowedOrigins + "'",
    };

    const corsMethodResponseParameters = {
      'method.response.header.Access-Control-Allow-Headers': true,
      'method.response.header.Access-Control-Allow-Methods': true,
      'method.response.header.Access-Control-Allow-Origin': true,
    };

    const userRes = userCreationAPI.restApi.root.addResource('user');

    const startWorkflowApiRole = new Role(this, 'UserHttpApiRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
    });

    startWorkflowApiRole.attachInlinePolicy(
      new Policy(this, 'AllowStartSyncExecution', {
        statements: [
          new PolicyStatement({
            actions: ['states:StartSyncExecution'],
            effect: Effect.ALLOW,
            resources: [workflow.stateMachine.stateMachineArn],
          }),
        ],
      }),
    );

    userRes.addMethod(
      'POST',
      new AwsIntegration({
        service: 'states',
        action: 'StartSyncExecution',
        options: {
          credentialsRole: startWorkflowApiRole,
          requestTemplates: {
            'application/json': `#set($req=$util.parseJson($input.json('$')))
#set($dummy = $req.put("requestId", $context.requestId))
{
  "stateMachineArn":"${workflow.stateMachine.stateMachineArn}",
  "input":"{#foreach($key in $req.keySet())\\"$key\\":\\"$req.get($key)\\"#if($foreach.hasNext),#end #end}"
}`,
          },
          integrationResponses: this.integrationResponse(corsIntegResponseParameters),
          passthroughBehavior: PassthroughBehavior.NEVER,
        },
      }),
      {
        requestValidator: new RequestValidator(this, 'user-validator', {
          restApi: userCreationAPI.restApi,
          requestValidatorName: 'user-validator',
          validateRequestBody: true,
        }),
        requestModels: {
          'application/json': this.userModel(userCreationAPI.restApi),
        },
        methodResponses: this.methodResponse(corsMethodResponseParameters),
      },
    );
    const origins: string[] = allowedOrigins.split(',');

    userRes.addCorsPreflight({
      allowHeaders: ['Authorization', '*'],
      allowOrigins: origins || ['*'],
      allowMethods: ['OPTIONS', 'POST'],
      allowCredentials: true,
    });
  }

  private userModel(userApi: RestApi) {
    return userApi.addModel('UserModel', {
      contentType: 'application/json',
      modelName: 'UserModel',
      schema: {
        schema: JsonSchemaVersion.DRAFT7,
        type: JsonSchemaType.OBJECT,
        properties: {
          firstname: { type: JsonSchemaType.STRING },
          lastname: { type: JsonSchemaType.STRING },
          birthdate: {
            type: JsonSchemaType.STRING,
            pattern: '^\\d{4}-(02-(0[1-9]|[12][0-9])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|(0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01]))$',
          },
          countrybirth: { type: JsonSchemaType.STRING, maxLength: 2 },
          country: { type: JsonSchemaType.STRING, enum: ['FR'] },
          postalcode: { type: JsonSchemaType.STRING, pattern: '^\\d{2}[ ]?\\d{3}$' },
          city: { type: JsonSchemaType.STRING },
          street: { type: JsonSchemaType.STRING },
          email: { type: JsonSchemaType.STRING, format: 'email', minLength: 6 },
          idcard: { type: JsonSchemaType.STRING },
        },
      },
    });
  }

  private methodResponse(corsMethodResponseParameters: { [destination: string]: boolean }): MethodResponse[] {
    return [
      {
        statusCode: '200',
        responseParameters: corsMethodResponseParameters,
      },
      {
        statusCode: '400',
        responseParameters: corsMethodResponseParameters,
      },
      {
        statusCode: '500',
        responseParameters: corsMethodResponseParameters,
      },
    ];
  }

  private integrationResponse(corsIntegResponseParameters: { [destination: string]: string }): IntegrationResponse[] {
    const errorResponse = [
      {
        selectionPattern: '4\\d{2}',
        statusCode: '400',
        responseParameters: corsIntegResponseParameters,
        responseTemplates: {
          'application/json': `{
              "error": "Bad input!"
            }`,
        },
      },
      {
        selectionPattern: '5\\d{2}',
        statusCode: '500',
        responseParameters: corsIntegResponseParameters,
        responseTemplates: {
          'application/json': '"error": $input.path(\'$.error\')',
        },
      },
    ];

    const integResponse = [
      {
        statusCode: '200',
        responseParameters: corsIntegResponseParameters,
        responseTemplates: {
          'application/json': `#set($inputRoot = $input.path('$'))
                  #if($input.path('$.status').toString().equals("FAILED"))
                      #set($context.responseOverride.status = 400)
                      {
                        "error": "$input.path('$.error')",
                        "cause": "$input.path('$.cause')"
                      }
                  #else
                      $input.path('$.output')
                  #end`,
        },
      },
      ...errorResponse,
    ];
    return integResponse;
  }
}
