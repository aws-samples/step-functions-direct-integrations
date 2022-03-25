#!/usr/bin/env python3
from setuptools import find_packages, setup

with open('src/requirements.txt') as f:
    requirements = f.readlines()

setup(
    author="Jerome Van Der Linden",
    license="MIT-0",
    name="verifyAddress",
    packages=find_packages(),
    install_requires=requirements,
    setup_requires=["pytest-runner"],
    test_suite="tests",
    tests_require=["pytest", "pytest-cov", "requests", "responses", "aws_lambda_powertools"],
    version="0.1.2"
)