'use strict';

// Deletes the accounts picked on the listing and returns the flash that reports the outcome.

const { redis } = require('../db');
const getSecret = require('../get-secret');
const { Account } = require('../account');
const { isClientError } = require('./route-helpers');

async function deleteAccountsInBatch({ accounts, call, logger, remoteAddress }) {
    const secret = await getSecret();

    const deleteResults = await getDeleteResults({ accounts, call, secret, logger, remoteAddress });

    const batchDeleteFlash = mapBatchDeleteFlash({ deleteResults });

    return batchDeleteFlash;
}

// One at a time: each delete tears down the account's workers, queues and tokens
const getDeleteResults = async ({ accounts, call, secret, logger, remoteAddress }) => {
    const deleteResults = { deleted: 0, missing: 0, failed: [] };
    for (const account of new Set(accounts)) {
        try {
            const { deleted } = await new Account({ redis, account, call, secret }).delete();
            deleteResults[deleted ? 'deleted' : 'missing']++;
        } catch (err) {
            if (isClientError(err) && err.output.statusCode === 404) {
                deleteResults.missing++;
                continue;
            }
            deleteResults.failed.push(account);
            logger.error({ msg: 'Failed to delete the account', err, account, remoteAddress });
        }
    }
    return deleteResults;
};

const mapBatchDeleteFlash = ({ deleteResults: { deleted, missing, failed } }) => {
    let message = `Deleted ${deleted} account${deleted === 1 ? '' : 's'}`;
    if (missing) {
        message += `, ${missing} not found`;
    }
    if (failed.length) {
        message += `. Couldn't delete ${failed.length}: ${failed.join(', ')}`;
    }
    return { type: failed.length ? 'danger' : 'info', message };
};

module.exports = { deleteAccountsInBatch };
