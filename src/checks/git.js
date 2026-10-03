import { run, runVisible } from '../exec.js';
import { ok, warn, fail } from '../result.js';

export default {
  id: 'git',
  title: 'Git',
  async run(ctx) {
    const results = [];
    const git = (args) => run(`git ${args}`, { cwd: ctx.cwd });

    if (ctx.exists('.gitmodules')) {
      const status = git('submodule status');
      // A leading "-" marks a submodule that was never checked out.
      const uninitialized = status.stdout.split(/\r?\n/).filter((line) => line.startsWith('-')).length;
      if (status.ok && uninitialized) {
        const command = 'git submodule update --init --recursive';
        results.push(
          fail(`${uninitialized} git submodule(s) are not checked out`, `Run \`${command}\`.`, {
            label: command,
            run: () => runVisible(command, ctx.cwd),
          }),
        );
      } else if (status.ok) {
        results.push(ok('Git submodules are checked out'));
      }
    }

    if (/filter=lfs/.test(ctx.read('.gitattributes') ?? '')) {
      if (git('lfs version').ok) results.push(ok('Git LFS is installed'));
      else results.push(fail('This repo stores files in Git LFS, but git-lfs is not installed', 'Install git-lfs, then run `git lfs install && git lfs pull`.'));
    }

    if (ctx.exists('.husky') && git('rev-parse --is-inside-work-tree').ok) {
      if (git('config --get core.hooksPath').stdout) results.push(ok('Git hooks (husky) are installed'));
      else results.push(warn('Husky git hooks are not installed, so pre-commit checks will not run', 'Run your install command again, or `npx husky`.'));
    }

    return results;
  },
};
