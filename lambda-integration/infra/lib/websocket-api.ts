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
import { WebSocketApi, WebSocketStage } from '@aws-cdk/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations';
import { AttributeType, BillingMode, Table } from '@aws-cdk/aws-dynamodb';
import { Effect, PolicyStatement } from '@aws-cdk/aws-iam';
import { Code, Function, LayerVersion, Runtime, Tracing } from '@aws-cdk/aws-lambda';
import { PythonFunction } from '@aws-cdk/aws-lambda-python';
import { RetentionDays } from '@aws-cdk/aws-logs';
import { CfnOutput, Construct, Duration, Stack } from '@aws-cdk/core';

export class UserWebSocketAPI extends Construct {
  readonly websocketConnectionsTable: Table;
  readonly notifyUserLambda: PythonFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.websocketConnectionsTable = new Table(this, 'WebsocketConnections', {
      partitionKey: { name: 'connectionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'validUntil',
    });

    const websocketConnectLambda = new Function(this, 'websocketConnect', {
      code: Code.fromAsset('functions/websocket'),
      handler: 'index.connect',
      runtime: Runtime.NODEJS_14_X,
      environment: {
        WEBSOCKET_TABLE: this.websocketConnectionsTable.tableName,
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      memorySize: 128,
    });
    this.websocketConnectionsTable.grant(websocketConnectLambda, 'dynamodb:PutItem');

    const websocketDisconnectLambda = new Function(this, 'websocketDisconnect', {
      code: Code.fromAsset('functions/websocket'),
      handler: 'index.disconnect',
      runtime: Runtime.NODEJS_14_X,
      environment: {
        WEBSOCKET_TABLE: this.websocketConnectionsTable.tableName,
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      memorySize: 128,
    });
    this.websocketConnectionsTable.grant(websocketDisconnectLambda, 'dynamodb:DeleteItem');

    const websocketMessageLambda = new Function(this, 'websocketMessage', {
      code: Code.fromAsset('functions/websocket'),
      handler: 'index.message',
      runtime: Runtime.NODEJS_14_X,
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      memorySize: 128,
    });

    const webSocketApi = new WebSocketApi(this, 'userWebSocket', {
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('WSConnection', websocketConnectLambda) },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('WSDisconnection', websocketDisconnectLambda),
      },
      defaultRouteOptions: { integration: new WebSocketLambdaIntegration('WSMessage', websocketMessageLambda) },
    });

    const websocketProd = new WebSocketStage(this, 'ProdStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    const apimgtPolicy = new PolicyStatement({
      actions: ['execute-api:Invoke', 'execute-api:ManageConnections'],
      effect: Effect.ALLOW,
      resources: [`arn:aws:execute-api:${Stack.of(this).region}:${Stack.of(this).account}:${webSocketApi.apiId}/prod/POST/@connections/*`],
    });

    websocketMessageLambda.addEnvironment('CONNECTION_ENDPOINT', websocketProd.callbackUrl);
    websocketMessageLambda.addToRolePolicy(apimgtPolicy);

    this.notifyUserLambda = new PythonFunction(this, 'notifyUser', {
      entry: 'functions/notifyUser',
      handler: 'index.handler',
      runtime: Runtime.PYTHON_3_9,
      description: 'Function that notify a user with websockets',
      environment: {
        CONNECTION_ENDPOINT: websocketProd.callbackUrl,
      },
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_WEEK,
      timeout: Duration.seconds(10),
      memorySize: 128,
      layers: [
        LayerVersion.fromLayerVersionArn(
          this,
          'powertoolsv3',
          `arn:aws:lambda:${Stack.of(this).region}:017000801446:layer:AWSLambdaPowertoolsPython:3`,
        ),
      ],
    });
    this.notifyUserLambda.addToRolePolicy(apimgtPolicy);

    new CfnOutput(this, 'userWebsocketUrl', {
      value: websocketProd.url,
    });

    new CfnOutput(this, 'userWebsocketCallbackUrl', {
      value: websocketProd.callbackUrl,
    });
  }
}
