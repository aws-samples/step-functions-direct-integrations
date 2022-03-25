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
"""Lambda function that check identity provided by the user versus the one extracted in the ID"""
from aws_lambda_powertools import Tracer
from aws_lambda_powertools import Logger

logger = Logger()
tracer = Tracer()

@tracer.capture_lambda_handler()
@logger.inject_lambda_context
def handler(event, _):
    """Cross check identity"""
    if event['firstname'].lower() != event['identity']['firstname'].lower():
        raise ValueError('Firstname does not match with ID card, please verify your input.')

    if event['lastname'].lower() != event['identity']['lastname'].lower():
        raise ValueError('Lastname does not match with ID card, please verify your input.')

    if event['birthdate'] != event['identity']['birthdate']:
        raise ValueError('Birthdate does not match with ID card, please verify your input.')

    return event
