import Component from '@glimmer/component';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { isSameMonth, isAfter, isBefore } from 'date-fns';
import getStorage from 'vault/lib/token-storage';
import { ARRAY_OF_MONTHS } from 'core/utils/date-formatters';
import { dateFormat } from 'core/helpers/date-format';

const INPUTTED_START_DATE = 'vault:ui-inputted-start-date';

export default class History extends Component {
  @service store;
  @service version;

  arrayOfMonths = ARRAY_OF_MONTHS;

  chartLegend = [
    { key: 'entity_clients', label: 'entity clients' },
    { key: 'non_entity_clients', label: 'non-entity clients' },
  ];

  // FOR START DATE EDIT & MODAL //
  months = Array.from({ length: 12 }, (item, i) => {
    return new Date(0, i).toLocaleString('en-US', { month: 'long' });
  });
  years = Array.from({ length: 5 }, (item, i) => {
    return new Date().getFullYear() - i;
  });
  currentDate = new Date();
  currentYear = this.currentDate.getFullYear(); // integer of year
  currentMonth = this.currentDate.getMonth(); // index of month

  @tracked isEditStartMonthOpen = false;
  @tracked startMonth = null;
  @tracked startYear = null;
  @tracked allowedMonthMax = 12;
  @tracked disabledYear = null;

  // FOR HISTORY COMPONENT //

  // RESPONSE
  @tracked endTimeFromResponse = this.args.model.endTimeFromResponse;
  @tracked startTimeFromResponse = this.args.model.startTimeFromLicense; // ex: ['2021', 3] is April 2021 (0 indexed)
  @tracked startTimeRequested = null;
  @tracked queriedActivityResponse = null;

  // SEARCH SELECT
  @tracked selectedNamespace = null;
  @tracked namespaceArray = this.getActivityResponse.byNamespace
    ? this.getActivityResponse.byNamespace.map((namespace) => ({
        name: namespace.label,
        id: namespace.label,
      }))
    : [];
  @tracked selectedAuthMethod = null;
  @tracked authMethodOptions = [];

  // TEMPLATE MESSAGING
  @tracked noActivityDate = '';
  @tracked responseRangeDiffMessage = null;
  @tracked isLoadingQuery = false;
  @tracked licenseStartIsCurrentMonth = this.args.model.activity?.isLicenseDateError || false;
  @tracked errorObject = null;

  get versionText() {
    return this.version.isEnterprise
      ? {
          label: 'Billing start month',
          description:
            'This date comes from your license, and defines when client counting starts. Without this starting point, the data shown is not reliable.',
          title: 'No billing start date found',
          message:
            'In order to get the most from this data, please enter your billing period start month. This will ensure that the resulting data is accurate.',
        }
      : {
          label: 'Client counting start date',
          description:
            'This date is when client counting starts. Without this starting point, the data shown is not reliable.',
          title: 'No start date found',
          message:
            'In order to get the most from this data, please enter a start month above. Vault will calculate new clients starting from that month.',
        };
  }

  get isDateRange() {
    return !isSameMonth(
      new Date(this.getActivityResponse.startTime),
      new Date(this.getActivityResponse.endTime)
    );
  }

  get upgradeVersionHistory() {
    const versionHistory = this.args.model.versionHistory;
    if (!versionHistory || versionHistory.length === 0) {
      return null;
    }

    // get upgrade data for initial upgrade to 1.9 and/or 1.10
    let relevantUpgrades = [];
    const importantUpgrades = ['1.9', '1.10'];
    importantUpgrades.forEach((version) => {
      let findUpgrade = versionHistory.find((versionData) => versionData.id.match(version));
      if (findUpgrade) relevantUpgrades.push(findUpgrade);
    });

    // if no history for 1.9 or 1.10, customer skipped these releases so get first stored upgrade
    // TODO account for customer STARTING on 1.11
    if (relevantUpgrades.length === 0) {
      relevantUpgrades.push({
        id: versionHistory[0].id,
        previousVersion: versionHistory[0].previousVersion,
        timestampInstalled: versionHistory[0].timestampInstalled,
      });
    }
    // array of upgrade data objects for noteworthy upgrades
    return relevantUpgrades;
  }

  get upgradeDuringActivity() {
    if (!this.upgradeVersionHistory) {
      return null;
    }
    const activityStart = new Date(this.getActivityResponse.startTime);
    const activityEnd = new Date(this.getActivityResponse.endTime);
    const upgradesWithinData = this.upgradeVersionHistory.filter((upgrade) => {
      // TODO how do timezones affect this?
      let upgradeDate = new Date(upgrade.timestampInstalled);
      return isAfter(upgradeDate, activityStart) && isBefore(upgradeDate, activityEnd);
    });
    // return all upgrades that happened within date range of queried activity
    return upgradesWithinData.length === 0 ? null : upgradesWithinData;
  }

  get upgradeVersionAndDate() {
    if (!this.upgradeDuringActivity) {
      return null;
    }
    if (this.upgradeDuringActivity.length === 2) {
      let firstUpgrade = this.upgradeDuringActivity[0];
      let secondUpgrade = this.upgradeDuringActivity[1];
      let firstDate = dateFormat([firstUpgrade.timestampInstalled, 'MMM d, yyyy'], { isFormatted: true });
      let secondDate = dateFormat([secondUpgrade.timestampInstalled, 'MMM d, yyyy'], { isFormatted: true });
      return `Vault was upgraded to ${firstUpgrade.id} (${firstDate}) and ${secondUpgrade.id} (${secondDate}) during this time range.`;
    } else {
      let upgrade = this.upgradeDuringActivity[0];
      return `Vault was upgraded to ${upgrade.id} on ${dateFormat(
        [upgrade.timestampInstalled, 'MMM d, yyyy'],
        { isFormatted: true }
      )}.`;
    }
  }

  get versionSpecificText() {
    if (!this.upgradeDuringActivity) {
      return null;
    }
    if (this.upgradeDuringActivity.length === 1) {
      let version = this.upgradeDuringActivity[0].id;
      if (version.match('1.9')) {
        return ' How we count clients changed in 1.9, so keep that in mind when looking at the data below.';
      }
      if (version.match('1.10')) {
        return ' We added monthly breakdowns starting in 1.10, so keep that in mind when looking at the data below.';
      }
    }
    // return combined explanation if spans multiple upgrades, or customer skipped 1.9 and 1.10
    return ' How we count clients changed in 1.9 and we added monthly breakdowns starting in 1.10. Keep this in mind when looking at the data below.';
  }

  get startTimeDisplay() {
    if (!this.startTimeFromResponse) {
      return null;
    }
    let month = this.startTimeFromResponse[1];
    let year = this.startTimeFromResponse[0];
    return `${this.arrayOfMonths[month]} ${year}`;
  }

  get endTimeDisplay() {
    if (!this.endTimeFromResponse) {
      return null;
    }
    let month = this.endTimeFromResponse[1];
    let year = this.endTimeFromResponse[0];
    return `${this.arrayOfMonths[month]} ${year}`;
  }

  // GETTERS FOR RESPONSE & DATA

  // on init API response uses license start_date, getter updates when user queries dates
  get getActivityResponse() {
    return this.queriedActivityResponse || this.args.model.activity;
  }

  get hasAttributionData() {
    if (this.selectedAuthMethod) return false;
    if (this.selectedNamespace) {
      return this.authMethodOptions.length > 0;
    }
    return !!this.totalClientsData && this.totalUsageCounts && this.totalUsageCounts.clients !== 0;
  }

  // top level TOTAL client counts for given date range
  get totalUsageCounts() {
    return this.selectedNamespace ? this.filteredActivity : this.getActivityResponse.total;
  }

  // total client data for horizontal bar chart in attribution component
  get totalClientsData() {
    if (this.selectedNamespace) {
      return this.filteredActivity?.mounts || null;
    } else {
      return this.getActivityResponse?.byNamespace;
    }
  }

  get responseTimestamp() {
    return this.getActivityResponse.responseTimestamp;
  }

  get byMonthTotalClients() {
    return this.getActivityResponse?.byMonth;
  }

  get byMonthNewClients() {
    return this.byMonthTotalClients.map((m) => m.new_clients);
  }

  get filteredActivity() {
    const namespace = this.selectedNamespace;
    const auth = this.selectedAuthMethod;
    if (!namespace && !auth) {
      return this.getActivityResponse;
    }
    if (!auth) {
      return this.getActivityResponse.byNamespace.find((ns) => ns.label === namespace);
    }
    return this.getActivityResponse.byNamespace
      .find((ns) => ns.label === namespace)
      .mounts?.find((mount) => mount.label === auth);
  }

  @action
  async handleClientActivityQuery(month, year, dateType) {
    this.isEditStartMonthOpen = false;
    if (dateType === 'cancel') {
      return;
    }
    // clicked "Current Billing period" in the calendar widget
    if (dateType === 'reset') {
      this.startTimeRequested = this.args.model.startTimeFromLicense;
      this.endTimeRequested = null;
    }
    // clicked "Edit" Billing start month in History which opens a modal.
    if (dateType === 'startTime') {
      let monthIndex = this.arrayOfMonths.indexOf(month);
      this.startTimeRequested = [year.toString(), monthIndex]; // ['2021', 0] (e.g. January 2021)
      this.endTimeRequested = null;
    }
    // clicked "Custom End Month" from the calendar-widget
    if (dateType === 'endTime') {
      // use the currently selected startTime for your startTimeRequested.
      this.startTimeRequested = this.startTimeFromResponse;
      this.endTimeRequested = [year.toString(), month]; // endTime comes in as a number/index whereas startTime comes in as a month name. Hence the difference between monthIndex and month.
    }

    try {
      this.isLoadingQuery = true;
      let response = await this.store.queryRecord('clients/activity', {
        start_time: this.startTimeRequested,
        end_time: this.endTimeRequested,
      });
      if (response.id === 'no-data') {
        // empty response (204) is the only time we want to update the displayed date with the requested time
        this.startTimeFromResponse = this.startTimeRequested;
        this.noActivityDate = this.startTimeDisplay;
      } else {
        // note: this.startTimeDisplay (getter) is updated by the @tracked startTimeFromResponse
        this.startTimeFromResponse = response.formattedStartTime;
        this.endTimeFromResponse = response.formattedEndTime;
        this.storage().setItem(INPUTTED_START_DATE, this.startTimeFromResponse);
      }
      this.queriedActivityResponse = response;
      this.licenseStartIsCurrentMonth = response.isLicenseDateError;
      // compare if the response startTime comes after the requested startTime. If true throw a warning.
      // only display if they selected a startTime
      if (
        dateType === 'startTime' &&
        isAfter(
          new Date(this.getActivityResponse.startTime),
          new Date(this.startTimeRequested[0], this.startTimeRequested[1])
        )
      ) {
        this.responseRangeDiffMessage = `You requested data from ${month} ${year}. We only have data from ${this.startTimeDisplay}, and that is what is being shown here.`;
      } else {
        this.responseRangeDiffMessage = null;
      }
    } catch (e) {
      this.errorObject = e;
      return e;
    } finally {
      this.isLoadingQuery = false;
    }
  }

  @action
  handleCurrentBillingPeriod() {
    this.handleClientActivityQuery(0, 0, 'reset');
  }

  @action
  selectNamespace([value]) {
    // value comes in as [namespace0]
    this.selectedNamespace = value;
    if (!value) {
      this.authMethodOptions = [];
      // on clear, also make sure auth method is cleared
      this.selectedAuthMethod = null;
    } else {
      // Side effect: set auth namespaces
      const mounts = this.filteredActivity.mounts?.map((mount) => ({
        id: mount.label,
        name: mount.label,
      }));
      this.authMethodOptions = mounts;
    }
  }

  @action
  setAuthMethod([authMount]) {
    this.selectedAuthMethod = authMount;
  }

  // FOR START DATE MODAL
  @action
  selectStartMonth(month, event) {
    this.startMonth = month;
    // disables months if in the future
    this.disabledYear = this.months.indexOf(month) >= this.currentMonth ? this.currentYear : null;
    event.close();
  }

  @action
  selectStartYear(year, event) {
    this.startYear = year;
    this.allowedMonthMax = year === this.currentYear ? this.currentMonth : 12;
    event.close();
  }

  storage() {
    return getStorage();
  }
}
