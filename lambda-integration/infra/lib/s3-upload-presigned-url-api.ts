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
import {
  AccessLogFormat,
  EndpointType,
  LambdaIntegration,
  LogGroupLogDestination,
  MethodLoggingLevel,
  RequestValidator,
  RestApi,
  RestApiProps,
} from '@aws-cdk/aws-apigateway';
import { Code, Function, LayerVersion, Runtime, Tracing } from '@aws-cdk/aws-lambda';
import { LogGroup, RetentionDays } from '@aws-cdk/aws-logs';
import { Bucket, HttpMethods } from '@aws-cdk/aws-s3';
import { Construct, Duration, RemovalPolicy, Stack } from '@aws-cdk/core';

const SERVICE_NAME = 'BankAccountCreation';

export interface S3UploadPresignedUrlAPIProps {
  /**
   * Optional CORS allowedOrigins.
   * Should allow your domain(s) as allowed origin to request the API
   *
   * @default '*'
   */
  readonly allowedOrigins?: string[];

  /**
   * Optional expiration time in second. Time before the presigned url expires.
   *
   * @default 300
   */
  readonly expiration?: number;
}

export class S3UploadPresignedUrlAPI extends Construct {
  public readonly restApi: RestApi;
  public readonly uploadBucket: Bucket;

  constructor(scope: Construct, id: string, props?: S3UploadPresignedUrlAPIProps) {
    super(scope, id);

    // S3 bucket where to upload files
    this.uploadBucket = new Bucket(this, 'uploadBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [HttpMethods.HEAD, HttpMethods.GET, HttpMethods.PUT],
          allowedOrigins: props?.allowedOrigins || ['*'],
          allowedHeaders: ['Authorization', '*'],
          maxAge: 3600,
        },
      ],
    });

    // Lambda function in charge of creating the PreSigned URL
    const getS3SignedUrlLambda = new Function(this, 'getS3SignedUrl', {
      code: Code.fromAsset('functions/getSignedUrl/'),
      handler: 'index.handler',
      runtime: Runtime.PYTHON_3_9,
      description: 'Function that creates a presigned URL to upload a file into S3',
      environment: {
        UPLOAD_BUCKET: this.uploadBucket.bucketName,
        URL_EXPIRATION_SECONDS: (props?.expiration || 300).toString(),
        LOG_LEVEL: 'INFO',
        POWERTOOLS_SERVICE_NAME: SERVICE_NAME,
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      memorySize: 128,
      layers: [
        LayerVersion.fromLayerVersionArn(
          this,
          'powertools',
          `arn:aws:lambda:${Stack.of(this).region}:017000801446:layer:AWSLambdaPowertoolsPython:3`,
        ),
      ],
    });

    this.uploadBucket.grantPut(getS3SignedUrlLambda);

    // Rest API
    const apiLogGroup = new LogGroup(this, 'BankAccountCreationApiLogs', {
      retention: RetentionDays.ONE_WEEK,
    });

    const apiProps: RestApiProps = {
      description: 'Bank account creation API',
      endpointTypes: [EndpointType.REGIONAL],
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(apiLogGroup),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: MethodLoggingLevel.INFO,
        metricsEnabled: true,
        tracingEnabled: true,
        dataTraceEnabled: false,
        stageName: 'prod',
      },
    };

    this.restApi = new RestApi(this, 'BankAccountCreationApi', apiProps);

    const corsIntegResponseParameters = {
      'method.response.header.Access-Control-Allow-Headers': "'Authorization, *'",
      'method.response.header.Access-Control-Allow-Methods': "'GET, OPTIONS'",
      'method.response.header.Access-Control-Allow-Origin': "'" + (props?.allowedOrigins?.join(',') || '*') + "'",
    };

    const corsMethodResponseParameters = {
      'method.response.header.Access-Control-Allow-Headers': true,
      'method.response.header.Access-Control-Allow-Methods': true,
      'method.response.header.Access-Control-Allow-Origin': true,
    };

    // Adding GET method on the API
    this.restApi.root.addMethod(
      'GET',
      new LambdaIntegration(getS3SignedUrlLambda, {
        proxy: false,
        requestTemplates: {
          'application/json':
            '{' + '"requestId" : "$context.requestId",' + '"contentType": "$util.escapeJavaScript($input.params(\'contentType\'))"' + '}',
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: corsIntegResponseParameters,
          },
          {
            selectionPattern: 'Input Error.*',
            statusCode: '400',
            responseParameters: corsIntegResponseParameters,
            responseTemplates: { 'application/json': "$input.path('$.errorMessage')" },
          },
          {
            selectionPattern: 'Internal Error.*',
            statusCode: '500',
            responseParameters: corsIntegResponseParameters,
            responseTemplates: { 'application/json': "$input.path('$.errorMessage')" },
          },
        ],
      }),
      {
        requestParameters: {
          'method.request.querystring.contentType': true,
        },
        methodResponses: [
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
        ],
        requestValidator: new RequestValidator(this, 'contenttype-validator', {
          restApi: this.restApi,
          requestValidatorName: 'contenttype-validator',
          validateRequestBody: false,
          validateRequestParameters: true,
        }),
      },
    );

    // CORS configuration for the API
    this.restApi.root.addCorsPreflight({
      allowHeaders: ['Authorization', '*'],
      allowOrigins: props?.allowedOrigins || ['*'],
      allowMethods: ['OPTIONS', 'GET'],
      allowCredentials: true,
    });
  }
}
