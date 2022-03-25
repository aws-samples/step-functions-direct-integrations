#
# Copyright 2022 Amazon Web Services (AWS)
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of this
# software and associated documentation files (the "Software"), to deal in the Software
# without restriction, including without limitation the rights to use, copy, modify,
# merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
# permit persons to whom the Software is furnished to do so.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
# INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
# PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
# HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
# OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
# SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
#
 ROOT_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

run-sfn-local:
	docker run -p 8083:8083 -d --rm --name stepfunctions-local \
  	--mount type=bind,readonly,source=$(ROOT_DIR)/test/MockConfigFile.json,destination=/home/StepFunctionsLocal/MockConfigFile.json \
  	-e SFN_MOCK_CONFIG="/home/StepFunctionsLocal/MockConfigFile.json" \
  	amazon/aws-stepfunctions-local

stop-sfn-local:
	docker stop stepfunctions-local

deploy:
	cdk deploy -O cdk.out/output.json --profile jvdl-Demo
	jq -r '.DirectBankAccountCreation|with_entries(select(.key | startswith("workflowStateMachineDefinition"))) | to_entries | .[].value' cdk.out/output.json > cdk.out/state_machine.asl.json

create:
	aws stepfunctions create-state-machine \
		--endpoint-url http://localhost:8083 \
		--definition file://cdk.out/state_machine.asl.json \
		--name "DirectIntegrationTest" \
		--role-arn "arn:aws:iam::123456789012:role/DummyRole" \
		--no-cli-pager

tests:
	npm run test


# happy:
# 	@echo "HappyPath:"
# 	@EXECUTION_ARN=$(shell aws stepfunctions start-execution \
# 		--endpoint http://localhost:8083 \
# 		--state-machine arn:aws:states:us-east-1:123456789012:stateMachine:DirectIntegrationTest#HappyPath \
# 		--input file://test/events/sfn_valid_input.json \
# 		--no-cli-pager | jq -r .executionArn); \
# 	aws stepfunctions describe-execution \
# 		--endpoint http://localhost:8083 \
# 		--execution-arn $$EXECUTION_ARN | jq -r '{status, output}'

