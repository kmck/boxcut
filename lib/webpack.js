import {
  Syntax,
} from 'esprima';
import escodegen from 'escodegen';

import {
  remapParams,
  getModuleName,
} from './utils';

const WEBPACK_REQUIRE = 'require';
const WEBPACK_MODULE_PARAMS = ['module', 'exports', WEBPACK_REQUIRE];
const WEBPACK_MODULE_PARAMS_LENGTH = WEBPACK_MODULE_PARAMS.length;

/**
 * Processes the Webpack module body, doing any parameter and module name replacement
 *
 * @param  {object} module - syntax tree
 * @param  {array} [moduleNames] - module name or path to the module for a given ID
 * @return {object} modifeid module node
 */
export function processWebpackModule(module, moduleNames = []) {
  if (module.type === Syntax.FunctionExpression && module.body) {
    const paramMap = module.params
      .reduce((params, param, i) => {
        if (i < WEBPACK_MODULE_PARAMS_LENGTH) {
          /* eslint-disable no-param-reassign */
          params[param.name] = WEBPACK_MODULE_PARAMS[i];
          /* eslint-enable no-param-reassign */
        }
        return params;
      }, {});
    return Object.assign({}, module, {
      body: remapParams(module.body, paramMap, moduleNames),
    });
  }
  return module;
}

/**
 * Recursively searches the syntax tree for a Webpack wrapper function
 *
 * @param  {Object} node - starting node for the search
 * @return {[type]}      [description]
 */
export function findWebpackExpression(node) {
  switch (node.type) {
  /**
   * If it's a call expression, we might have found what we're looking for.
   * We make the final determination whether it's actually a Webpack wrapper function by examining
   * the callee and the arguments.
   *
   * The callee is a function that takes a single parameter for the modules:
   *
   * function webpackWrapper(modules) { ... }
   *
   * The arguments have a single member, which is an array:of module functions (although we aren't
   * enforcing that they are modules):
   *
   * [...[function() { ... }]]
   */
    case Syntax.CallExpression: {
      if (
        node.callee.type === Syntax.FunctionExpression &&
        node.callee.params.length === 1 &&
        node.arguments.length === 1 &&
        node.arguments[0].type === Syntax.ArrayExpression
      ) {
        // This looks enough like a Webpack wrapper, so we're done!
        return node;
      }

      // If it's the wrong type of expression, dig into the callee
      return findWebpackExpression(node.callee);
    }

    /**
     * Minifiers can turn the bundle into IIFE into a unary expression
     */
    case Syntax.UnaryExpression: {
      return findWebpackExpression(node.argument);
    }

    /**
     * For all other expressions, crack it open and see what else is inside
     */
    case Syntax.ExpressionStatement: {
      if (node.expression) {
        return findWebpackExpression(node.expression);
      }
      break;
    }

    default:
      break;
  }

  /**
   * If we haven't found something yet, continue recursively searching any subtrees
   */
  if (node.body) {
    return node.body
      .reduce((result, child) => {
        const subtreeResult = findWebpackExpression(child);
        return subtreeResult || null;
      }, null);
  }

  // Leaf case
  return null;
}

/**
 * Grabs and processes all modules in the Webpack build
 *
 * @param  {object} expression - Webpack module expression root
 * @return {object} mapping of module names to their content
 */
export function extractWebpackExpressionModules(expression) {
  const [webpackModules] = expression.arguments;
  const moduleNames = webpackModules.elements
    .map((module, i) => getModuleName(module, i));
  const moduleContents = webpackModules.elements
    .map((module) => {
      const processedModule = processWebpackModule(module, moduleNames);
      if (processedModule.type === Syntax.FunctionExpression && processedModule.body) {
        if (processedModule.body.type === Syntax.BlockStatement) {
          return processedModule.body.body.map(body => escodegen.generate(body)).join('\n');
        }
        return escodegen.generate(processedModule.body);
      }
      return escodegen.generate(processedModule);
    });

  return moduleContents
    .reduce((modulesByName, moduleContent, id) => {
      /* eslint-disable no-param-reassign */
      modulesByName[moduleNames[id]] = moduleContent;
      /* eslint-enable no-param-reassign */
      return modulesByName;
    }, {});
}
