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
import { readFileSync } from 'fs';
import { resolve } from 'path';
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  DescribeExecutionCommand,
  DescribeExecutionCommandOutput,
  SFNClient,
  StartExecutionCommand,
  StartExecutionCommandOutput,
} from '@aws-sdk/client-sfn';

const MAX_RETRIES = 5;
const stateMachineArn = 'arn:aws:states:us-east-1:123456789012:stateMachine:DirectIntegrationTest';
const client = new SFNClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8083',
});

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
jest.setTimeout(30000);

test('Happy Path', async () => {
  // GIVEN
  const event = readFileSync(resolve(__dirname, 'events/sfn_valid_input.json'));

  // WHEN
  const startResponse: StartExecutionCommandOutput = await startExecution('HappyPath', event);
  const status: string | undefined = await waitForStatusOfExecution(startResponse.executionArn);

  // THEN
  expect(status).toBe('SUCCEEDED');
});

test('Wrong identity (birthdate)', async () => {
  // GIVEN
  const event = readFileSync(resolve(__dirname, 'events/sfn_invalid_identity_birth.json'));

  // WHEN
  const startResponse: StartExecutionCommandOutput = await startExecution('HappyPath', event);
  const status: string | undefined = await waitForStatusOfExecution(startResponse.executionArn);

  // THEN
  expect(status).toBe('FAILED');
});

// DescribeExecutionCommand only runs with STANDARD workflows, we cannot use an EXPRESS for tests (see create in the Makefile)
async function waitForStatusOfExecution(executionArn?: string) {
  const statusCommand = new DescribeExecutionCommand({
    executionArn,
  });
  let status: string | undefined = 'RUNNING';
  let retries = 0;
  while (status === 'RUNNING' && retries++ < MAX_RETRIES) {
    await pause(200);
    const statusResponse: DescribeExecutionCommandOutput = await client.send(statusCommand);
    status = statusResponse.status;
    console.log(statusResponse);
  }
  return status;
}

// We cannot use the StartSyncExecution with Step Functions Local because it adds "sync" to localhost
// Error: "AWS SDK error wrapper for Error: getaddrinfo ENOTFOUND sync-localhost"
// https://github.com/localstack/localstack/issues/5258#issuecomment-1050159827
async function startExecution(test: string, event: Buffer): Promise<StartExecutionCommandOutput> {
  const startCommand = new StartExecutionCommand({
    stateMachineArn: `${stateMachineArn}#${test}`,
    input: event.toString('utf-8'),
  });
  return await client.send(startCommand);
}
