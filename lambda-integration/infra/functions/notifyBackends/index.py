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
"""Lambda function that put an event on User Event Bus to notify backends"""
import os
import json
import boto3
from aws_lambda_powertools import Tracer
from aws_lambda_powertools import Logger

logger = Logger()
tracer = Tracer()

eb = boto3.client('events')

if 'EVENTBUS_NAME' not in os.environ or os.environ['EVENTBUS_NAME'] is None:
    raise RuntimeError('EVENTBUS_NAME env var is not set')

EVENTBUS_NAME = os.environ['EVENTBUS_NAME']

@logger.inject_lambda_context
@tracer.capture_lambda_handler()
def handler(event, _):

    eb.put_events(
        Entries=[
            {
                'Source': 'user',
                'DetailType': 'UserCreated',
                'Detail': json.dumps(event),
                'EventBusName': EVENTBUS_NAME
            },
        ]
    )

    return event
