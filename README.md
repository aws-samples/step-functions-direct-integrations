## Direct Service Integrations

This repo is associated with the AWS Blog post: [Optimizing architecture using direct service integrations]().

It is divided in two parts:

 * [Initial architecture](./lambda-integration/), that makes heavy use of AWS Lambda functions to perform all operations.
 * [Improved architecture](./direct-integration/), that get ride of most of them and favor direct integrations when that make sense.

As general recommendations:

 * Don't use Lambda functions to transport data (from one service to another), use them to **transform** data.
 * Don't use Lambda functions to just make AWS API call, use Step Functions Direct Integration to do that and use Lambda to **implement business logic** when Step Functions is not enough.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

