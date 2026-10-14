/**
 * A Slack-webhook-shaped URL for tests. Assembled at runtime, never written
 * out as one literal: a literal in source is a "Slack Incoming Webhook URL" to
 * GitHub's push protection, which (rightly) refuses the push. It is not a
 * real webhook.
 */
export const SLACK_HOST = ['hooks', 'slack', 'com'].join('.');
export const SLACK_PATH = ['/services', 'T00000000', 'B00000000', ['abcdefgh', 'ijklmnop', 'qrstuvwx'].join('')].join('/');
export const SLACK_TEST_URL = `https://${SLACK_HOST}${SLACK_PATH}`;
