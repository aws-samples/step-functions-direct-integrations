# -*- coding: utf-8 -*-
# Copyright 2022 Amazon Web Services

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
"""Lambda function that extract information from an ID Card picture, using Amazon Textract"""
import os
from datetime import datetime
import boto3
from aws_lambda_powertools import Tracer
from aws_lambda_powertools import Logger
from trp import Document

logger = Logger()
tracer = Tracer()

textract = boto3.client('textract', region_name=os.environ['AWS_REGION'])

if 'UPLOAD_BUCKET' not in os.environ or os.environ['UPLOAD_BUCKET'] is None or not os.environ['UPLOAD_BUCKET']:
    raise RuntimeError('UPLOAD_BUCKET env var is not set')

UPLOAD_BUCKET = os.environ["UPLOAD_BUCKET"]

@tracer.capture_lambda_handler(capture_response=False)
@logger.inject_lambda_context
def handler(event, _):
    try:
        if not event['idcard']:
            raise KeyError('idcard empty')
    except KeyError as error:
        raise ValueError('Missing idcard parameter') from error
    else:
        s3key = event['idcard']

    response = extract_info_from_id(UPLOAD_BUCKET, s3key)

    result = {
        'firstnames': None,
        'lastname': None,
        'birthdate': None
    }
    doc = Document(response)
    for field in doc.pages[0].form.fields:
        if any(x in field.key.text for x in ["Prénom", "Given name"]):
            result['firstnames'] = field.value.text.split(', ')
        elif any(x in field.key.text for x in ["DATE DE NAISS", "Date of birth", "Né(e) le"]):
            bdate = field.value.text.replace('.', ' ').replace('/', ' ')
            result['birthdate'] = datetime.strftime(datetime.strptime(bdate, "%d %m %Y"), '%Y-%m-%d')
        elif any(x in field.key.text for x in ["Nom", "NOM", "Surname"]):
            result['lastname'] = field.value.text

    if result['firstnames'] is None or result['lastname'] is None or result['birthdate'] is None:
        raise ValueError('Could not extract all information from the ID Card')

    return result

def extract_info_from_id(bucket, s3key):
    try:
        response = textract.analyze_document(
            Document={
                'S3Object' : {
                    'Bucket': bucket,
                    'Name': s3key
                }
            },
            FeatureTypes=['FORMS']
        )
        return response
    except Exception as error:
        raise ValueError('Could not extract information from the ID Card') from error