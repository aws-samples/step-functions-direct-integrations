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
"""Lambda function that lookups for a user in DynamoDB table, throw an error if (s)he exists"""
import os
import boto3
from aws_lambda_powertools import Tracer
from aws_lambda_powertools import Logger
from boto3.dynamodb.conditions import Key

logger = Logger()
tracer = Tracer()

ddb = boto3.resource('dynamodb')

if 'USER_TABLE' not in os.environ or os.environ['USER_TABLE'] is None:
    raise RuntimeError('USER_TABLE env var is not set')

USER_TABLE = os.environ['USER_TABLE']
table = ddb.Table(USER_TABLE)

@logger.inject_lambda_context
@tracer.capture_lambda_handler()
def handler(event, _):
    """Check if a user already exists in the dynamodb table"""

    response = table.query(
        Select='SPECIFIC_ATTRIBUTES',
        IndexName='fullname',
        ProjectionExpression="id",
        KeyConditionExpression=Key('lastname').eq(event['lastname']) & Key('firstname').eq(event['firstname']),
    )

    if response['Count'] > 0:
        raise ValueError('User already exists')

    return event
