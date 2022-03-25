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
import os
import json
import re
import boto3
from aws_lambda_powertools import Tracer
from aws_lambda_powertools import Logger
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit

logger = Logger()
tracer = Tracer()
metrics = Metrics()

sqs = boto3.client('sqs')

SQS_URL_PATTERN = re.compile(r"^https:\/\/sqs.[a-z]{2}((-gov)|(-iso(b?)))?-[a-z]+-\d{1}.amazonaws.com\/\d{12}\/[a-zA-Z0-9-_]+$")

if ('SQS_QUEUE_URL' not in os.environ
    or os.environ['SQS_QUEUE_URL'] is None
    or not SQS_URL_PATTERN.match(os.environ['SQS_QUEUE_URL'])):
    raise RuntimeError('SQS_QUEUE_URL env var is not set or incorrect')

SQS_QUEUE_URL = os.environ['SQS_QUEUE_URL']

@metrics.log_metrics
@logger.inject_lambda_context
@tracer.capture_lambda_handler()
def handler(event, _):
    """Send a message on a SQS Queue"""
    try:
        sqs.send_message(
            QueueUrl=SQS_QUEUE_URL,
            MessageBody=json.dumps({i:event[i] for i in event if i!='error'}),
            MessageAttributes={
                'error': {
                    'DataType': 'String',
                    'StringValue': json.loads(event['error']['Cause'])['errorMessage']
                }
            }
        )
    except Exception as error:
        # catch all errors, as we don't want to fail here
        metrics.add_metric(name="ErrorSendingToDLQ", unit=MetricUnit.Count, value=1)
        logger.exception(error)
