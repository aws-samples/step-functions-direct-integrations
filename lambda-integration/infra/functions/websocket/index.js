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
const AWS = require('aws-sdk');

const ddb = new AWS.DynamoDB.DocumentClient();

exports.connect = async (event) => {
    console.log(JSON.stringify(event));

    tableName = process.env.WEBSOCKET_TABLE;

    if (!tableName) {
        throw new Error('tableName not specified in process.env.WEBSOCKET_TABLE');
    }

    var expiryTimestamp = Math.floor(new Date() / 1000) + 3600;

    const putParams = {
        TableName: tableName,
        Item: {
          connectionId: event.requestContext.connectionId,
          validUntil: expiryTimestamp.toString()
        }
      };

    try {
        await ddb.put(putParams).promise();
    } catch (err) {
        console.error(JSON.stringify(err))
        return { statusCode: 500, body: 'Failed to connect: ' + JSON.stringify(err) };
    }

    return { statusCode: 200, body: 'Connection established' };
}

exports.message = async (event) => {
    console.log(JSON.stringify(event));

    const apiGwMgt = new AWS.ApiGatewayManagementApi({
        endpoint: process.env.CONNECTION_ENDPOINT,
        sslEnabled: true
    });

    try {
        var socketParams = {
            ConnectionId: event.requestContext.connectionId,
            Data: `{"connectionId": "${event.requestContext.connectionId}"}`
        };
        await apiGwMgt.postToConnection(socketParams).promise();
    } catch (error) {
        console.error(error);
    }

    return {statusCode: 200 };
}

exports.disconnect = async (event) => {
    console.log(JSON.stringify(event));

    tableName = process.env.WEBSOCKET_TABLE;

    if (!tableName) {
        throw new Error('tableName not specified in process.env.WEBSOCKET_TABLE');
    }

    const deleteParams = {
        TableName: tableName,
        Key: {
            connectionId: event.requestContext.connectionId
        }
    };

    try {
        await ddb.delete(deleteParams).promise();
    } catch (err) {
        console.error(JSON.stringify(err))
        return { statusCode: 500, body: 'Failed to disconnect: ' + JSON.stringify(err) };
    }

    return { statusCode: 200, body: 'Disconnected.' };
}