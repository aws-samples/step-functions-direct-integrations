# -*- coding: utf-8 -*-
# Copyright 2021 Jerome Van Der Linden

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

import responses
import pytest
import os
from unittest import mock
from src import index
from importlib import reload
from dataclasses import dataclass

@pytest.fixture
def lambda_context():
    """ mock Lambda context """
    @dataclass
    class LambdaContext:
        function_name: str = "test"
        memory_limit_in_mb: int = 128
        invoked_function_arn: str = "arn:aws:lambda:eu-west-1:809313241:function:test"
        aws_request_id: str = "52fdfc07-2182-154f-163f-5f0f9a621d72"

    return LambdaContext()

def mockenv(**envvars):
    """ mock os.environ """
    return mock.patch.dict(os.environ, envvars, clear=True)

@responses.activate
def test_happy_path_should_return_valid_address(lambda_context):
    responses.add(responses.GET, index.ADDRESS_API,
                json={
                    "features":[
                        {
                            "properties":{
                                "label":"8 Boulevard du Port 80000 Amiens",
                                "score":0.89159121588068583
                            }
                        }
                    ]
                }, status=200)
    result = index.handler({
        "street": "8 Boulevard du Port",
        "postalcode": "80000",
        "city": "Amiens"
    }, lambda_context)

    assert result['address'] == "8 Boulevard du Port 80000 Amiens"

@responses.activate
def test_low_confidence_should_raise_error(lambda_context):
    responses.add(responses.GET, index.ADDRESS_API,
                json={
                    "features":[
                        {
                            "properties":{
                                "label":"8 Boulevard du Port 80000 Amiens",
                                "score":0.49159121588068583
                            }
                        }
                    ]
                }, status=200)
    with pytest.raises(ValueError, match=r"Address is incorrect.*"):
        index.handler({
            "street": "8 Boulevard du Port",
            "postalcode": "80000",
            "city": "Amiens"
        }, lambda_context)

@responses.activate
def test_no_result_should_raise_error(lambda_context):
    responses.add(responses.GET, index.ADDRESS_API,
                json={
                    "features":[]
                }, status=200)
    with pytest.raises(ValueError, match=r"Address is incorrect.*"):
        index.handler({
            "street": "8 Boulevard du Port",
            "postalcode": "80000",
            "city": "Amiens"
        }, lambda_context)

def test_no_input_should_raise_error(lambda_context):
    with pytest.raises(ValueError, match=r"Invalid parameters.*"):
        index.handler({
        }, lambda_context)

@responses.activate
def test_exception_should_raise_error(lambda_context):
    responses.add(responses.GET, index.ADDRESS_API,
                body=Exception('Connection Error'))
    with pytest.raises(RuntimeError, match=r"Request Error.*"):
        index.handler({
            "street": "8 Boulevard du Port",
            "postalcode": "80000",
            "city": "Amiens"
        }, lambda_context)

@mockenv(CONFIDENCE_THRESHOLD="0.75")
@responses.activate
def test_threshold_configuration(lambda_context):
    reload(index) # avoid reusing previous config
    responses.add(responses.GET, index.ADDRESS_API,
                json={
                    "features":[
                        {
                            "properties":{
                                "label":"8 Boulevard du Port 80000 Amiens",
                                "score":0.76
                            }
                        }
                    ]
                }, status=200)
    result = index.handler({
        "street": "8 Boulevard du Port",
        "postalcode": "80000",
        "city": "Amiens"
    }, lambda_context)

    assert result['address'] == "8 Boulevard du Port 80000 Amiens"