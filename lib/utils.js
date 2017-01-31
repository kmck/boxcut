import {
  Syntax,
} from 'esprima';

/**
 * Recursively searches the syntax tree for any scope variables that were declared
 *
 * @param  {Object} node - syntax tree to search
 * @param  {array} [scopeVariables] - list of the scope variables names that were encountered
 * @return {array} - all scope variables found in the tree
 */
export function getScopeVariables(node, scopeVariables = []) {
  if (Array.isArray(node)) {
    node.forEach(nodeElement => getScopeVariables(nodeElement, scopeVariables));
  } else if (node && typeof node === 'object') {
    if (node.type === Syntax.VariableDeclaration) {
      if (node.kind === 'var') {
        node.declarations
          .forEach((declaration) => {
            scopeVariables.push(declaration.id);
          });
      }
    } else {
      Object.keys(node)
        .forEach((key) => {
          getScopeVariables(node[key], scopeVariables);
        });
    }
  }
  return scopeVariables;
}

/**
 * Searches the syntax tree for identifiers to remap and require() expressions that can have an ID
 * replaced with a module name
 *
 * @param  {Object} srcNode - syntax tree to search
 * @param  {Object} srcParamMap - mapping of parameters to their output
 * @param  {array} [moduleNames] - module name or path to the module for a given ID
 * @param  {string} requireName - name of the require function
 * @return {Object} the processed syntax tree
 */
export function remapParams(srcNode, srcParamMap, moduleNames = [], requireName = 'require') {
  if (!srcNode || typeof srcNode !== 'object') {
    return srcNode;
  }

  const paramMap = { ...srcParamMap };
  if (Array.isArray(srcNode)) {
    const scopeVariables = getScopeVariables(srcNode);
    scopeVariables.forEach((param) => {
      delete paramMap[param.name];
    });
    return srcNode.map(nodeElement => remapParams(nodeElement, paramMap, moduleNames));
  }

  const node = { ...srcNode };
  switch (node.type) {
    /**
     * Replace require(moduleId) with the named module identifier, if possible
     */
    case Syntax.CallExpression: {
      if (
        node.callee.name in paramMap &&
        paramMap[node.callee.name] === requireName &&
        node.arguments.length === 1
      ) {
        const moduleName = moduleNames[node.arguments[0].value];
        if (moduleName) {
          node.arguments = [{
            type: Syntax.Literal,
            value: `./${moduleName}`,
            raw: `'./${moduleName}'`,
          }];
        }
      }
      break;
    }

    /**
     * Rename identifiers that are remapped
     */
    case Syntax.Identifier: {
      if (node.name in paramMap) {
        node.name = paramMap[node.name];
      }
      break;
    }

    /**
     * Function parameters should
     */
    case Syntax.FunctionExpression:
      node.params
        .forEach((param) => {
          delete paramMap[param.name];
        });
      break;

    case Syntax.VariableDeclaration:
      break;

    default: {
      // Fix scope things
      if (node.type === Syntax.FunctionExpression) {
        node.params
          .forEach((param) => {
            delete paramMap[param.name];
          });
      }
    }
  }

  // if not Syntax.Identifier or Syntax.VariableDeclaration
  if (!(node.type === Syntax.Identifier || node.type === Syntax.VariableDeclaration)) {
    Object.keys(node)
      .forEach((key) => {
        if (key !== 'params') {
          node[key] = remapParams(node[key], paramMap, moduleNames, requireName);
        }
      });
  }
  return node;
}

/**
 * Converts a subtree of member expressions into a single path
 *
 * @param  {object} node - syntax tree to search
 * @return {string} member expression path
 */
export function flattenMemberExpression(node) {
  if (node.type === Syntax.FunctionExpression) {
    return node.id ? node.id.name : '';
  } else if (node.type === Syntax.Literal) {
    return node.value;
  } else if (node.type === Syntax.Identifier) {
    return node.name;
  } else if (node.type === Syntax.MemberExpression) {
    return [
      node.computed ? node.object.name : flattenMemberExpression(node.object),
      flattenMemberExpression(node.property),
    ].join('.');
  }
  return '';
}

/**
 * Finds (more or less) export expressions in the subtree for use when determining a name for an
 * extracted module
 *
 * @param  {object} node - module's syntax tree root
 * @param  {object}  [moduleExports] - running list of exports
 * @return {object} any exports found
 */
export function findModuleExports(node, moduleExports = {}) {
  if (Array.isArray(node)) {
    node.forEach((nodeElement) => {
      findModuleExports(nodeElement, moduleExports);
    });
  } else if (node && typeof node === 'object') {
    if (node.type === Syntax.AssignmentExpression) {
      if (flattenMemberExpression(node.left).match(/^(.+\.)?exports$/)) {
        const inferredModuleName = flattenMemberExpression(node.right);
        let moduleName = inferredModuleName;
        let i = 0;
        while (moduleName in moduleExports) {
          i += 1;
          moduleName = `${inferredModuleName}__${i}`;
        }
        /* eslint-disable no-param-reassign */
        moduleExports[moduleName] = true;
        /* eslint-enable no-param-reassign */
      }
    }
    Object.keys(node)
      .forEach((key) => {
        findModuleExports(node[key], moduleExports);
      });
  }
  return moduleExports;
}

/**
 * Infers a name for the module based on its exports
 *
 * @param  {object} module - module's syntax tree root
 * @param  {string} id - module ID
 * @return {string} module name
 */
export function getModuleName(module, id) {
  let moduleName = '';
  if (module.type === Syntax.FunctionExpression && module.body) {
    const moduleExports = Object.keys(findModuleExports(module.body));
    if (moduleExports.length) {
      moduleName = moduleExports[0];
    }
  }
  return moduleName || `module-${id}`;
}
