'use strict';

// The accounts listing's filters (search field, status, type) and its batch delete, kept out of
// account-routes.js.

const Joi = require('joi');

const { redis } = require('../db');
const getSecret = require('../get-secret');
const { Account } = require('../account');
const { accountIdSchema, ACCOUNT_DISPLAY_STATES } = require('../schemas');
const { OAUTH_PROVIDERS } = require('../oauth2-apps');
const { DEFAULT_PAGE_SIZE } = require('../consts');
const { isClientError, ACCOUNT_STATE_DISPLAY } = require('./route-helpers');

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

const markOptions = (options, selected) => options.map(entry => Object.assign({ checked: (selected || []).includes(entry.value) }, entry));

// View values for the topbar search, its filter menu, the active-filter summary and the batch delete form
function filterView(current) {
    let groups = [
        { title: 'Status', name: 'state', options: markOptions(ACCOUNT_STATE_FILTERS, current.state) },
        { title: 'Type', name: 'type', options: markOptions(ACCOUNT_TYPE_FILTERS, current.type) }
    ];
    let activeFilters = groups.flatMap(group => group.options.filter(entry => entry.checked).map(entry => ({ group: group.title, label: entry.label })));

    return {
        searchByOptions: SEARCH_FIELDS.map(entry => Object.assign({ selected: entry.value === (current.searchBy || '') }, entry)),
        filterMenu: {
            groups,
            label: activeFilters.length === 1 ? activeFilters[0].label : activeFilters.length ? `${activeFilters.length} filters` : 'All accounts'
        },
        activeFilters,
        filtersActive: activeFilters.length > 0,
        clearFiltersUrl: listingUrl({ pageSize: current.pageSize, query: current.query, searchBy: current.searchBy }),
        currentUrl: listingUrl(current, current.page)
    };
}

function registerPostAccountsBatchDelete(server, args) {
    const { call } = args;

    server.route({
        method: 'POST',
        path: '/admin/accounts/batch-delete',
        async handler(request, h) {
            const secret = await getSecret();
            let counts = { deleted: 0, missing: 0 };
            let failed = [];

            // One at a time: each delete tears down the account's workers, queues and tokens
            for (let account of new Set(request.payload.accounts)) {
                try {
                    let { deleted } = await new Account({ redis, account, call, secret }).delete();
                    counts[deleted ? 'deleted' : 'missing']++;
                } catch (err) {
                    if (isClientError(err) && err.output.statusCode === 404) {
                        counts.missing++;
                        continue;
                    }
                    failed.push(account);
                    request.logger.error({ msg: 'Failed to delete the account', err, account, remoteAddress: request.app.ip });
                }
            }

            await request.flash({ type: failed.length ? 'danger' : 'info', message: batchDeleteMessage(counts, failed) });
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

function batchDeleteMessage({ deleted, missing }, failed) {
    let message = `Deleted ${deleted} account${deleted === 1 ? '' : 's'}`;
    if (missing) {
        message += `, ${missing} not found`;
    }
    if (failed.length) {
        message += `. Couldn't delete ${failed.length}: ${failed.join(', ')}`;
    }
    return message;
}

module.exports = { ACCOUNT_TYPE_FILTERS, BATCH_DELETE_MAX, listingQuerySchemas, listingUrl, filterView, registerPostAccountsBatchDelete };
