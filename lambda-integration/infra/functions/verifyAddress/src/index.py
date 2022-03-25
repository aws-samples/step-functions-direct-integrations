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
"""Lambda function that verifies an address is valid, use a 3rd party API to check"""
import os
import requests
from aws_lambda_powertools import Tracer
from aws_lambda_powertools import Logger

logger = Logger()
tracer = Tracer()

ADDRESS_API="https://api-adresse.data.gouv.fr/search/"

if 'CONFIDENCE_THRESHOLD' in os.environ and os.environ['CONFIDENCE_THRESHOLD'] is not None:
    THRESHOLD = os.environ['CONFIDENCE_THRESHOLD']
else:
    THRESHOLD = '0.82'

@tracer.capture_lambda_handler()
@logger.inject_lambda_context
def handler(event, _):

    try:
        if not event['street'] or not event['city'] or not event['postalcode']:
            raise KeyError('missing parameters')
    except KeyError as error:
        raise ValueError('Invalid parameters: you must provide "street", "city" and "postalcode"') from error

    response = None
    try:
        response = requests.get(ADDRESS_API, params={
            'q': event['street'] + ' ' + event['city'],
            'autocomplete': '0',
            'postcode': event['postalcode'],
            'limit': '1'
        }).json()
    except Exception as error:
        raise RuntimeError('Request Error') from error

    if (response is not None
        and 'features' in response
        and len(response['features']) > 0
        and response['features'][0]['properties']['score'] > float(THRESHOLD)):

        event['address'] = response['features'][0]['properties']['label']
        return event

    raise ValueError('Address is incorrect, please verify your input')


