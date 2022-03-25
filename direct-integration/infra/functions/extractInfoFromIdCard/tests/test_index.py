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
import pytest
import os
import json
from unittest import mock, TestCase
from importlib import reload
from dataclasses import dataclass
# import botocore.session
# from botocore.stub import Stubber

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

def load_mock_file(path):
    expected_response_file = open(os.path.join(os.path.dirname(__file__),path), 'r')
    return json.load(expected_response_file)

def extract_happy_path(_, __):
    return load_mock_file('res/happy_path.json')

def extract_no_id(_, __):
    return load_mock_file('res/no_id.json')

def extract_raise_error(_, __):
    raise ValueError('Could not extract information from the ID Card')

with mock.patch.dict(os.environ, {'UPLOAD_BUCKET':'my_bucket', 'AWS_REGION':'eu-central-1'}, clear=True):
    from src import index

class ExtractInfoFromIdCardTest(TestCase):

    @mock.patch('src.index.extract_info_from_id', side_effect=extract_happy_path)
    def test_happy_path_should_retrieve_info(self, lambda_context):
        result = index.handler({"idcard":"id_card.jpeg"}, lambda_context)

        assert result['lastname'] == 'BERTHIER'
        assert result['birthdate'] == '1965-12-06'
        assert result['firstnames'] == ["CORINNE"]

    @mock.patch('src.index.extract_info_from_id', side_effect=extract_no_id)
    def test_no_id_should_raise_error(self, lambda_context):
        with pytest.raises(ValueError, match=r"Could not extract all information from the ID Card"):
            index.handler({"idcard":"wallpaper.jpeg"}, lambda_context)


    @mock.patch('src.index.extract_info_from_id', side_effect=extract_raise_error)
    def test_extract_error_should_raise_error(self, lambda_context):
        with pytest.raises(ValueError, match=r"Could not extract information from the ID Card"):
            index.handler({"idcard":"whatever.jpeg"}, lambda_context)

    @mock.patch('src.index.extract_info_from_id', side_effect=extract_raise_error)
    def test_no_input_should_raise_error(self, lambda_context):
        with pytest.raises(ValueError, match=r"Missing idcard parameter"):
            index.handler({}, lambda_context)

    @mock.patch('src.index.extract_info_from_id', side_effect=extract_raise_error)
    def test_empty_input_should_raise_error(self, lambda_context):
        with pytest.raises(ValueError, match=r"Missing idcard parameter"):
            index.handler({'idcard':''}, lambda_context)
