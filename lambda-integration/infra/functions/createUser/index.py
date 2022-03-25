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
"""Lambda function that insert a user in DynamoDB"""
import os
import string
import random
from datetime import datetime
from aws_lambda_powertools import Tracer
from aws_lambda_powertools import Logger
from pynamodb.models import Model
from pynamodb.attributes import (
    UnicodeAttribute, UTCDateTimeAttribute
)

logger = Logger()
tracer = Tracer()

if 'USER_TABLE' not in os.environ or os.environ['USER_TABLE'] is None:
    raise RuntimeError('USER_TABLE env var is not set')

USER_TABLE = os.environ['USER_TABLE']

class User(Model):
    """Model for a User to be inserted in DynamoDB"""

    class Meta:
        """Metadata for User Model (pynamodb)"""
        table_name = USER_TABLE
        region = os.environ['AWS_REGION']

    id = UnicodeAttribute(hash_key=True)
    lastname = UnicodeAttribute(range_key=True)
    firstname = UnicodeAttribute()
    birthdate = UnicodeAttribute()
    birthcountry = UnicodeAttribute()
    address = UnicodeAttribute()
    email = UnicodeAttribute()
    idcardref = UnicodeAttribute()
    created_at = UTCDateTimeAttribute()
    updated_at = UTCDateTimeAttribute()

@tracer.capture_lambda_handler()
@logger.inject_lambda_context
def handler(event, _):

    characters = string.ascii_letters + string.digits
    user_id = ''.join(random.choice(characters) for i in range(16))
    now = datetime.utcnow()

    user = User(id = user_id,
        lastname=event['user']['lastname'],
        firstname=event['user']['firstname'],
        birthdate=event['user']['birthdate'],
        birthcountry=event['user']['countrybirth'],
        address=event['user']['address'],
        email=event['user']['email'],
        idcardref=event['user']['idcard'],
        created_at = now,
        updated_at = now
    )
    user.save()

    event['user']['id'] = user_id
    return event['user']
