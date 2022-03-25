# -*- coding: utf-8 -*-
# Copyright 2021 Amazon Web Services

# Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
# associated documentation files (the "Software"), to deal in the Software without restriction,
# including without limitation the rights to use, copy, modify, merge, publish, distribute,
# sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
# furnished to do so.

# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
# BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
# NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
# DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
"""Lambda function in charge of starting the execution of a state machine"""
import os
import json
import re
import boto3
from aws_lambda_powertools import Tracer
from aws_lambda_powertools import Logger

logger = Logger()
tracer = Tracer()

sfn = boto3.client('stepfunctions')

PATTERN = re.compile(r"^arn:(aws[a-zA-Z-]*)?:states:[a-z]{2}((-gov)|(-iso(b?)))?-[a-z]+-\d{1}:\d{12}:stateMachine:[a-zA-Z0-9-_]+$")

if ('STATE_MACHINE_ARN' not in os.environ
    or os.environ['STATE_MACHINE_ARN'] is None
    or not PATTERN.match(os.environ['STATE_MACHINE_ARN'])):
    raise RuntimeError('STATE_MACHINE_ARN env var is not set or incorrect')

STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']

@logger.inject_lambda_context
@tracer.capture_lambda_handler
def handler(event, context):
    """Start the execution of a state machine"""
    try:
        event['requestId'] = context.aws_request_id

        sfn.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            input=json.dumps(event)
        )

        return {
            "requestId" : event['requestId']
        }
    except Exception as error:
        logger.exception(error)
        raise RuntimeError('Internal Error - cannot start the creation workflow') from error
