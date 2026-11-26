'use strict';

// The accounts listing's filter values, query schemas, listing URL and batch delete route, kept out
// of account-routes.js. The view and the delete itself are story files next to it.

const Joi = require('joi');

const { accountIdSchema, ACCOUNT_DISPLAY_STATES } = require('../schemas');
const { OAUTH_PROVIDERS } = require('../oauth2-apps');
const { DEFAULT_PAGE_SIZE } = require('../consts');
const { ACCOUNT_STATE_DISPLAY } = require('./route-helpers');
const { deleteAccountsInBatch } = require('./delete-accounts-in-batch');

// Type filter values, matching the `type` that Account#listAccounts() derives for each row
const ACCOUNT_TYPE_FILTERS = [
    { value: 'imap', label: 'IMAP' },
    { value: 'sending', label: 'SMTP only' },
    ...Object.entries(OAUTH_PROVIDERS).map(([value, label]) => ({ value, label })),
    { value: 'oauth2', label: 'OAuth2 (unknown app)' },
    { value: 'delegated', label: 'Delegated' },
    { value: 'invalid', label: 'Invalid delegation' }
];

// 'errors' is a virtual state covering every attention state
const ACCOUNT_STATE_FILTERS = [{ value: 'errors', label: 'Needs attention' }, ...ACCOUNT_STATE_DISPLAY.map(({ state, label }) => ({ value: state, label }))];

const SEARCH_FIELDS = [
    { value: '', label: 'All fields' },
    { value: 'name', label: 'Name' },
    { value: 'email', label: 'Email' },
    { value: 'account', label: 'Account ID' },
    { value: 'domain', label: 'Domain' }
];

const BATCH_DELETE_MAX = 250;

// A repeated query argument (or a single one) filtering on any of the listed values
const multiValue = (values, description) =>
    Joi.array()
        .items(
            Joi.string()
                .trim()
                .valid(...values)
        )
        .single()
        .default([])
        .description(description);

const listingQuerySchemas = {
    searchBy: Joi.string()
        .empty('')
        .valid(...SEARCH_FIELDS.map(entry => entry.value).filter(Boolean))
        .description('Field the search is limited to'),
    state: multiValue([...ACCOUNT_DISPLAY_STATES, 'errors'], 'Filter accounts by states, "errors" for every attention state'),
    type: multiValue(
        ACCOUNT_TYPE_FILTERS.map(entry => entry.value),
        'Filter accounts by account types'
    )
};

/**
 * Listing URL for a page, keeping the request's search, filters and page size.
 *
 * @param {Object} current - the validated listing query
 * @param {Number} [page] - one-based page
 * @returns {String}
 */
function listingUrl(current, page) {
    let url = new URL('admin/accounts', 'http://localhost');
    let params = {
        page: page ? [page] : [],
        pageSize: current.pageSize && current.pageSize !== DEFAULT_PAGE_SIZE ? [current.pageSize] : [],
        query: [].concat(current.query || []),
        searchBy: current.query ? [].concat(current.searchBy || []) : [],
        state: current.state || [],
        type: current.type || []
    };
    for (let [key, values] of Object.entries(params)) {
        values.forEach(value => url.searchParams.append(key, value));
    }
    return url.pathname + url.search;
}

function registerPostAccountsBatchDelete(server, args) {
    const { call } = args;

    server.route({
        method: 'POST',
        path: '/admin/accounts/batch-delete',
        async handler(request, h) {
            const flash = await deleteAccountsInBatch({ accounts: request.payload.accounts, call, logger: request.logger, remoteAddress: request.app.ip });
            await request.flash(flash);
            return h.redirect(request.payload.returnTo);
        },
        options: {
            validate: {
                options: {
                    stripUnknown: true,
                    abortEarly: false,
                    convert: true
                },

                async failAction(request, h, err) {
                    await request.flash({ type: 'danger', message: `Couldn't delete the selected accounts. Try again.` });
                    request.logger.error({ msg: 'Failed to batch delete accounts', err });
                    return h.redirect('/admin/accounts').takeover();
                },

                payload: Joi.object({
                    accounts: Joi.array().items(accountIdSchema).single().min(1).max(BATCH_DELETE_MAX).required(),
                    // back to the listing with the filters it had, never anywhere else
                    returnTo: Joi.string()
                        .max(2048)
                        .pattern(/^\/admin\/accounts(\?[^#]*)?$/)
                        .default('/admin/accounts')
                })
            }
        }
    });
}

module.exports = {
    ACCOUNT_STATE_FILTERS,
    ACCOUNT_TYPE_FILTERS,
    BATCH_DELETE_MAX,
    SEARCH_FIELDS,
    listingQuerySchemas,
    listingUrl,
    registerPostAccountsBatchDelete
};
