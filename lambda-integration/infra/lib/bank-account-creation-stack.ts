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
import { JsonSchemaType, JsonSchemaVersion, LambdaIntegration, RequestValidator, ResponseType } from '@aws-cdk/aws-apigateway';
import { AttributeType, BillingMode, Table } from '@aws-cdk/aws-dynamodb';
import { Code, Function, LayerVersion, Runtime, Tracing } from '@aws-cdk/aws-lambda';
import { RetentionDays } from '@aws-cdk/aws-logs';
import { StateMachineType } from '@aws-cdk/aws-stepfunctions';
import { Construct, Duration, Stack, StackProps } from '@aws-cdk/core';
import { LambdaToStepfunctions } from '@aws-solutions-constructs/aws-lambda-stepfunctions';
import { AccountCreationWorkflow } from './account-creation-workflow';
import { S3UploadPresignedUrlAPI } from './s3-upload-presigned-url-api';
import { UserWebSocketAPI } from './websocket-api';

const SERVICE_NAME = 'BankAccountCreation';

export class BankAccountCreationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Parameters (using context)
    const allowedOrigins: string = this.node.tryGetContext('origins') || '*';
    const origins: string[] = allowedOrigins.split(',');

    const expiration: number = this.node.tryGetContext('expiration') || 300;

    const uploadAPI = new S3UploadPresignedUrlAPI(this, 'uploadAPI', {
      allowedOrigins: origins,
      expiration: expiration,
    });

    const userNotifAPI = new UserWebSocketAPI(this, 'userNotifAPI');

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

    const workflow = new AccountCreationWorkflow(this, 'workflow', {
      uploadBucket: uploadAPI.uploadBucket,
      userTable: userTable,
      notifyLambda: userNotifAPI.notifyUserLambda,
    });

    const startWorkflowLambda = new Function(this, 'startWorkflow', {
      code: Code.fromAsset('functions/startWorkflow/'),
      handler: 'index.handler',
      runtime: Runtime.PYTHON_3_9,
      description: 'Function that starts the account creation workflow',
      environment: {
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: SERVICE_NAME,
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      memorySize: 256,
      layers: [
        LayerVersion.fromLayerVersionArn(this, 'powertool', `arn:aws:lambda:${Stack.of(this).region}:017000801446:layer:AWSLambdaPowertoolsPython:3`),
      ],
    });

    new LambdaToStepfunctions(this, 'accountCreation', {
      existingLambdaObj: startWorkflowLambda,
      stateMachineProps: {
        definition: workflow.definition,
        tracingEnabled: true,
        stateMachineType: StateMachineType.EXPRESS,
      },
    });

    const userModel = uploadAPI.restApi.addModel('UserModel', {
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

    const userRes = uploadAPI.restApi.root.addResource('user');

    userRes.addMethod(
      'POST',
      new LambdaIntegration(startWorkflowLambda, {
        proxy: false,
        integrationResponses: [
          {
            statusCode: '202',
            responseParameters: corsIntegResponseParameters,
          },
          {
            selectionPattern: '.*Error.*',
            statusCode: '500',
            responseParameters: corsIntegResponseParameters,
            responseTemplates: { 'application/json': "$input.path('$.errorMessage')" },
          },
        ],
      }),
      {
        requestParameters: {
          'method.request.header.Content-Type': true,
        },
        requestValidator: new RequestValidator(this, 'user-validator', {
          restApi: uploadAPI.restApi,
          requestValidatorName: 'user-validator',
          validateRequestBody: true,
        }),
        requestModels: {
          'application/json': userModel,
        },
        methodResponses: [
          {
            statusCode: '202',
            responseParameters: corsMethodResponseParameters,
          },
          {
            statusCode: '500',
            responseParameters: corsMethodResponseParameters,
          },
        ],
      },
    );

    userRes.addCorsPreflight({
      allowHeaders: ['Authorization', '*'],
      allowOrigins: origins || ['*'],
      allowMethods: ['OPTIONS', 'POST'],
      allowCredentials: true,
    });

    uploadAPI.restApi.addGatewayResponse('validationerror', {
      type: ResponseType.BAD_REQUEST_BODY,
      responseHeaders: corsIntegResponseParameters,
      templates: { 'application/json': '$context.error.validationErrorString' },
    });
  }
}
