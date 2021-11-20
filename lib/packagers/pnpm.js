'use strict';
/**
 * PNPM packager.
 */

const _ = require('lodash');
const BbPromise = require('bluebird');
const Utils = require('../utils');

class PNPM {
  // eslint-disable-next-line lodash/prefer-constant
  static get lockfileName() {
    return 'pnpm-lock.yaml';
  }

  static get copyPackageSectionNames() {
    return [];
  }

  // eslint-disable-next-line lodash/prefer-constant
  static get mustCopyModules() {
    return true;
  }

  static getProdDependencies(cwd, depth) {
    // Get first level dependency graph
    const command = /^win/.test(process.platform) ? 'pnpm.cmd' : 'pnpm';
    const args = [
      'ls',
      '-prod', // Only prod dependencies
      '-json',
      `-depth=${depth || 1}`
    ];

    const ignoredPpnpmErrors = [
      { pnpmError: 'code ELSPROBLEMS', log: false }, // pnpm >= 7
      { pnpmError: 'extraneous', log: false },
      { pnpmError: 'missing', log: false },
      { pnpmError: 'peer dep missing', log: true }
    ];

    return Utils.spawnProcess(command, args, {
      cwd: cwd
    })
      .catch(err => {
        if (err instanceof Utils.SpawnError) {
          // Only exit with an error if we have critical pnpm errors for 2nd level inside
          // ignoring any extra output from pnpm >= 7
          const lines = _.split(err.stderr, '\n');
          const errors = _.takeWhile(lines, line => line !== '{');
          const failed = _.reduce(
            errors,
            (failed, error) => {
              if (failed) {
                return true;
              }
              return (
                !_.isEmpty(error) &&
                !_.some(ignoredPpnpmErrors, ignoredError => _.startsWith(error, `pnpm ERR! ${ignoredError.pnpmError}`))
              );
            },
            false
          );

          if (!failed && !_.isEmpty(err.stdout)) {
            return BbPromise.resolve({ stdout: err.stdout });
          }
        }

        return BbPromise.reject(err);
      })
      .then(processOutput => processOutput.stdout)
      .then(depJson => BbPromise.try(() => JSON.parse(depJson)));
  }

  static _rebaseFileReferences(pathToPackageRoot, moduleVersion) {
    if (/^file:[^/]{2}/.test(moduleVersion)) {
      const filePath = _.replace(moduleVersion, /^file:/, '');
      return _.replace(`file:${pathToPackageRoot}/${filePath}`, /\\/g, '/');
    }

    return moduleVersion;
  }

  /**
   * We should not be modifying 'package-lock.json'
   * because this file should be treated as internal to pnpm.
   *
   * Rebase package-lock is a temporary workaround and must be
   * removed as soon as https://github.com/pnpm/pnpm/issues/19183 gets fixed.
   */
  static rebaseLockfile(pathToPackageRoot, lockfile) {
    if (lockfile.version) {
      lockfile.version = PNPM._rebaseFileReferences(pathToPackageRoot, lockfile.version);
    }

    if (lockfile.dependencies) {
      _.forIn(lockfile.dependencies, lockedDependency => {
        PNPM.rebaseLockfile(pathToPackageRoot, lockedDependency);
      });
    }

    return lockfile;
  }

  static install(cwd, packagerOptions) {
    if (packagerOptions.noInstall) {
      return BbPromise.resolve();
    }

    const command = /^win/.test(process.platform) ? 'pnpm.cmd' : 'pnpm';
    const args = ['install'];

    return Utils.spawnProcess(command, args, { cwd }).return();
  }

  static prune(cwd) {
    const command = /^win/.test(process.platform) ? 'pnpm.cmd' : 'pnpm';
    const args = ['prune'];

    return Utils.spawnProcess(command, args, { cwd }).return();
  }

  static runScripts(cwd, scriptNames) {
    const command = /^win/.test(process.platform) ? 'pnpm.cmd' : 'pnpm';
    return BbPromise.mapSeries(scriptNames, scriptName => {
      const args = [ 'run', scriptName ];

      return Utils.spawnProcess(command, args, { cwd });
    }).return();
  }
}

module.exports = PNPM;
