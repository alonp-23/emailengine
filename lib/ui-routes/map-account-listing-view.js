'use strict';

// View values for the accounts listing: the topbar search, its filter menu, the active-filter
// summary and the batch delete form.

const { ACCOUNT_STATE_FILTERS, ACCOUNT_TYPE_FILTERS, SEARCH_FIELDS, listingUrl } = require('./account-listing');

function mapAccountListingView({ current }) {
    const searchByOptions = mapSearchByOptions({ current });

    const groups = mapFilterGroups({ current });

    const activeFilters = mapActiveFilters({ groups });

    const baseQuery = pickBaseQuery({ current });

    const quickViews = mapQuickViews({ current, activeFilters, baseQuery });

    const filterMenuLabel = mapFilterMenuLabel({ activeFilters });

    const accountListingView = {
        searchByOptions,
        filterMenu: { quickViews, groups, label: filterMenuLabel },
        activeFilters,
        filtersActive: activeFilters.length > 0,
        clearFiltersUrl: listingUrl(baseQuery),
        currentUrl: listingUrl(current, current.page)
    };

    return accountListingView;
}

const mapSearchByOptions = ({ current }) => SEARCH_FIELDS.map(entry => Object.assign({ selected: entry.value === (current.searchBy || '') }, entry));

const mapFilterGroups = ({ current }) => {
    const markOptions = (options, selected) => options.map(entry => Object.assign({ checked: (selected || []).includes(entry.value) }, entry));
    // 'Needs attention' is a quick view; its checkbox only shows while it applies, so it can be unticked
    const stateOptions = markOptions(ACCOUNT_STATE_FILTERS, current.state).filter(entry => entry.value !== 'errors' || entry.checked);

    return [
        { title: 'Status', name: 'state', options: stateOptions },
        { title: 'Type', name: 'type', options: markOptions(ACCOUNT_TYPE_FILTERS, current.type) }
    ];
};

const mapActiveFilters = ({ groups }) =>
    groups.flatMap(group => group.options.filter(entry => entry.checked).map(entry => ({ group: group.title, label: entry.label })));

// the search and page size, which the quick views and Clear filters keep
const pickBaseQuery = ({ current }) => ({ pageSize: current.pageSize, query: current.query, searchBy: current.searchBy });

const mapQuickViews = ({ current, activeFilters, baseQuery }) => {
    const isOnlyErrors = !(current.type || []).length && (current.state || []).join() === 'errors';

    return [
        { label: 'All accounts', url: listingUrl(baseQuery), active: !activeFilters.length },
        { label: 'Needs attention', url: listingUrl(Object.assign({ state: ['errors'] }, baseQuery)), active: isOnlyErrors }
    ];
};

const mapFilterMenuLabel = ({ activeFilters }) => {
    if (activeFilters.length === 1) {
        return activeFilters[0].label;
    }
    return activeFilters.length ? `${activeFilters.length} filters` : 'All accounts';
};

module.exports = { mapAccountListingView };
