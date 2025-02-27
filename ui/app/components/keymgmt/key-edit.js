import Component from '@glimmer/component';
import { inject as service } from '@ember/service';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import { waitFor } from '@ember/test-waiters';

/**
 * @module KeymgmtKeyEdit
 * KeymgmtKeyEdit components are used to display KeyMgmt Secrets engine UI for Key items
 *
 * @example
 * ```js
 * <KeymgmtKeyEdit @model={model} @mode="show" @tab="versions" />
 * ```
 * @param {object} model - model is the data from the store
 * @param {string} [mode=show] - mode controls which view is shown on the component
 * @param {string} [tab=details] - Options are "details" or "versions" for the show mode only
 */

const LIST_ROOT_ROUTE = 'vault.cluster.secrets.backend.list-root';
const SHOW_ROUTE = 'vault.cluster.secrets.backend.show';
export default class KeymgmtKeyEdit extends Component {
  @service store;
  @service router;
  @service flashMessages;
  @tracked isDeleteModalOpen = false;

  get mode() {
    return this.args.mode || 'show';
  }

  get keyAdapter() {
    return this.store.adapterFor('keymgmt/key');
  }

  get isMutable() {
    return ['create', 'edit'].includes(this.args.mode);
  }

  get isCreating() {
    return this.args.mode === 'create';
  }

  @action
  toggleModal(bool) {
    this.isDeleteModalOpen = bool;
  }

  @task
  @waitFor
  *saveKey(evt) {
    evt.preventDefault();
    const { model } = this.args;
    try {
      yield model.save();
      this.router.transitionTo(SHOW_ROUTE, model.name);
    } catch (error) {
      this.flashMessages.danger(error.errors.join('. '));
    }
  }

  @action
  async removeKey() {
    try {
      await this.keyAdapter.removeFromProvider(this.args.model);
      this.flashMessages.success('Key has been successfully removed from provider');
    } catch (error) {
      this.flashMessages.danger(error.errors?.join('. '));
    }
  }

  @action
  deleteKey() {
    const secret = this.args.model;
    const backend = secret.backend;
    secret
      .destroyRecord()
      .then(() => {
        this.router.transitionTo(LIST_ROOT_ROUTE, backend);
      })
      .catch((e) => {
        this.flashMessages.danger(e.errors?.join('. '));
      });
  }

  @action
  rotateKey(id) {
    const backend = this.args.model.get('backend');
    const adapter = this.keyAdapter;
    adapter
      .rotateKey(backend, id)
      .then(() => {
        this.flashMessages.success(`Success: ${id} connection was rotated`);
      })
      .catch((e) => {
        this.flashMessages.danger(e.errors);
      });
  }
}
