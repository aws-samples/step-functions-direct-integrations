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
"""Lambda function that generates an S3 presigned url to enable upload (PUT) on S3"""
import os
import mimetypes
import boto3
from aws_lambda_powertools import Tracer
from aws_lambda_powertools import Logger

logger = Logger()
tracer = Tracer()

s3 = boto3.client('s3')

if 'UPLOAD_BUCKET' not in os.environ or os.environ['UPLOAD_BUCKET'] is None:
    raise RuntimeError('UPLOAD_BUCKET env var is not set')

UPLOAD_BUCKET = os.environ["UPLOAD_BUCKET"]

if 'URL_EXPIRATION_SECONDS' in os.environ and os.environ['URL_EXPIRATION_SECONDS'] is not None:
    URL_EXPIRATION_SECONDS = os.environ['URL_EXPIRATION_SECONDS']
else:
    URL_EXPIRATION_SECONDS = '300'

@logger.inject_lambda_context
@tracer.capture_lambda_handler()
def handler(event, _):

    s3_key = ''
    content_type = ''

    try:
        api_request_id = event['requestId']
        content_type = event['contentType']
        extension = mimetypes.guess_extension(content_type)
        s3_key = api_request_id + extension
    except Exception as error:
        logger.error(error)
        raise ValueError('Input Error: "contentType" parameter is invalid') from error

    try:
        signed_url = s3.generate_presigned_url(
            ClientMethod='put_object',
            Params={
                'Bucket': UPLOAD_BUCKET,
                'Key': s3_key,
                'ContentType': content_type
            },
            ExpiresIn=URL_EXPIRATION_SECONDS)

        return {
            'uploadURL': signed_url,
            'key': s3_key
        }
    except Exception as error:
        logger.error(error)
        raise RuntimeError('Internal Error: could not generate a presigned URL') from error
