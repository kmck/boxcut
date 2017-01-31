#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import esprima from 'esprima';
import minimist from 'minimist';
import chalk from 'chalk';
import { js_beautify as beautify } from 'js-beautify';

import {
  findWebpackExpression,
  extractWebpackExpressionModules,
} from './webpack';

const {
  stdin,
  stdout,
} = process;

const {
  input,
  output = process.cwd(),
} = minimist(process.argv.slice(2));

// Read the JS file
let jsSrc;
if (!stdin.isTTY) {
  stdout.write(chalk.cyan('Reading standard input...\n'));
  const chunks = [];
  stdin.on('data', (chunk) => {
    chunks.push(chunk);
  });
  stdin.on('end', () => {
    jsSrc = chunks.join('');
  });
} else if (input) {
  stdout.write(chalk.cyan(`Reading modules from ${chalk.magenta(input)}...\n`));
  jsSrc = fs.readFileSync(input).toString();
} else {
  stdout.write(chalk.red('Error: Missing input path!\n'));
  process.exit(1);
}

// Parse the source code
const jsTree = esprima.parse(jsSrc);
const webpackExpression = findWebpackExpression(jsTree);
if (webpackExpression) {
  const beautifyOptions = {
    indent_size: 2,
    end_with_newline: true,
  };
  const webpackModules = extractWebpackExpressionModules(webpackExpression);
  stdout.write(`Found ${chalk.magenta(Object.keys(webpackModules).length)} modules.\n`);
  Object.keys(webpackModules)
    .forEach((moduleName) => {
      const moduleContent = webpackModules[moduleName];
      const outFile = path.join(output, `${moduleName}.js`);
      fs.mkdirp(path.dirname(outFile));
      fs.outputFile(outFile, `${beautify(moduleContent, beautifyOptions)}\n`, (err) => {
        if (err) {
          stdout.write(chalk.red(`Error writing ${chalk.blue(outFile)}\n`));
        } else {
          stdout.write(chalk.green(`Successfully wrote module to ${chalk.blue(outFile)}\n`));
        }
      });
    });
} else {
  stdout.write(chalk.red('Error: Could not find a Webpack wrapper!\n'));
  process.exit(1);
}
