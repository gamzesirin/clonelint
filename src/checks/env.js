import fs from 'node:fs';
import { loadEnv } from '../dotenv.js';
import { ok, warn, fail, list } from '../result.js';

export default {
  id: 'env',
  title: 'Environment variables',
  async run(ctx) {
    const { templateFile, template, files, vars, target } = loadEnv(ctx);
    if (!templateFile || !template.size) return [];

    if (!files.length) {
      return [
        fail(`${target} does not exist (${templateFile} defines ${template.size} variables)`, `Copy ${templateFile} to ${target} and fill in the values.`, {
          label: `create ${target} from ${templateFile}`,
          run: () => fs.copyFileSync(ctx.resolve(templateFile), ctx.resolve(target), fs.constants.COPYFILE_EXCL),
        }),
      ];
    }

    const results = [];
    const where = files.join(' + ');
    // Variables exported in the shell count as set.
    const missing = [...template.keys()].filter((key) => !vars.has(key) && process.env[key] === undefined);
    if (missing.length) {
      const file = files.includes(target) ? target : files[0];
      results.push(
        fail(`${where} is missing ${missing.length} of ${template.size} variables from ${templateFile}: ${list(missing)}`, `Add them to ${file}.`, {
          label: `add ${missing.length} missing variables to ${file}`,
          run: () => {
            const lines = missing.map((key) => template.get(key).raw);
            fs.appendFileSync(ctx.resolve(file), `\n# Added by clonelint from ${templateFile}\n${lines.join('\n')}\n`);
          },
        }),
      );
    }

    const empty = [...template.keys()].filter((key) => vars.get(key)?.value === '' && template.get(key).value !== '' && !process.env[key]);
    if (empty.length) {
      results.push(warn(`${empty.length} variables are empty in ${where} but have a value in ${templateFile}: ${list(empty)}`, 'Fill them in if the app needs them.'));
    }

    if (!results.length) results.push(ok(`${where} defines all ${template.size} variables from ${templateFile}`));
    return results;
  },
};
