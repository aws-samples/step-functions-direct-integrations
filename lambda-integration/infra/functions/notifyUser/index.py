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
import boto3
from aws_lambda_powertools import Tracer
from aws_lambda_powertools import Logger

logger = Logger()
tracer = Tracer()

if 'CONNECTION_ENDPOINT' not in os.environ or os.environ['CONNECTION_ENDPOINT'] is None:
    raise RuntimeError('CONNECTION_ENDPOINT env var is not set')

apigw = boto3.client('apigatewaymanagementapi', endpoint_url=os.environ['CONNECTION_ENDPOINT'])

@logger.inject_lambda_context
@tracer.capture_lambda_handler()
def handler(event, _):

    if 'error' in event:
        data = {
            'error': True,
            'message': 'Error during the subscription: ' + event['error']['errorMessage']
        }
    else:
        data = {
            'message': 'Registration successful, your account will be created within 24 hours.'
        }

    try :
        apigw.post_to_connection(
            Data=json.dumps(data),
            ConnectionId=event['connectionId']
        )
    except Exception as error:
        logger.error(error)

    return event
