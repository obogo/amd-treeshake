function Optimizer() {
    var count = 0;
    var keyTypes = {
        shorten: function (defs, currentKey) {
            var key = '', parts = currentKey.split('/'), offset = 0;
            if (parts.length > 1) {
                do {
                    offset += 1;
                    key = (parts[parts.length - offset] || '-') + key;
                } while (defs[key]);// make sure it is unique.
                return key;
            } else {
                return parts[0];
            }
        },
        obfuscate: function (defs, currentKey) {
            var key = uid(count);
            while (defs[key]) {
                count += 1;
                key = uid(count);
            }
            return key;
        }
    };

    function uid(n) {
        var ordA = 'a'.charCodeAt(0);
        var ordZ = 'z'.charCodeAt(0);
        var len = ordZ - ordA + 1;

        var s = "";
        while (n >= 0) {
            s = String.fromCharCode(n % len + ordA) + s;
            n = Math.floor(n / len) - 1;
        }
        return s;
    }

    function getMangle(mangle) {
        if (typeof mangle === "function") {
            return mangle;
        }
        return keyTypes[mangle];
    }

    function run(contents, extract, mangle) {
        var defs = extract(contents);// extract all defines.
        var keys = Object.keys(defs);
        for (var i = 0; i < keys.length; i += 1) {
            var key = getMangle(mangle)(defs, keys[i]);// make a unique key
            changeDefName(defs, keys[i], key);// now update all references to that key
        }
        count = 0;// reset.
        return defs;
    }

    function changeDefName(defs, currentKey, newKey) {
        if (currentKey === newKey) {
            return;
        }
        var def = defs[newKey] = defs[currentKey];
        delete defs[currentKey];
        def.name = newKey;
        def.comment = '//# sourceTS:' + currentKey + '=' + newKey;
        var index;
        // now update all import references
        for (var i in defs) {
            if (defs.hasOwnProperty(i)) {
                do {
                    index = defs[i].imports.indexOf(currentKey);
                    if (index !== -1) {
                        defs[i].imports[index] = newKey;
                    }
                } while (index !== -1);
            }
        }
    }

    this.run = run;
}

function AMDTools() {
    var defineNameRx = /^("|')(.*?)\1/;
    var importsRx = /[,\s]+\[(.*?)\]/;
    var importCleanupRx = /(\s|"|')/g;
    var fnCleanupRx = /[,\s]+function/;

    function extract(contents) {
        var defines, aliases = {};
        contents = contents.replace(/\/\/# sourceTS:(.*?)=(.*?)\s+/g, function (m, g1, g2) {
            aliases[g2.replace(/\s+/g, '')] = g1;
            return '';
        });
        defines = contents.split(/\s?define\(/);
        defines.aliases = aliases;
        defines.cache = {};
        defines.map(cleanUpDefinition);
        return defines.cache;
    }

    function cleanUpDefinition(content, index, list) {
        var name, imports, item, aliases = list.aliases;
        content = content.replace(defineNameRx, function (m, g1, g2) {
            name = g2;
            return '';
        });
        content = content.replace(importsRx, function (m, g1) {
            imports = g1.replace(importCleanupRx, '').split(',');
            return '';
        });
        content = content.replace(fnCleanupRx, function () {
            return 'function';
        });
        if (name) {
            item = {name: name, imports: imports, content: content};
            if (aliases[name]) {
                item.alias = aliases[name];
            }
            list.cache[name] = item;
        }
    }

    function defsJoin(defs, comment) {
        var str = '', def, imp;
        for (var i in defs) {
            if (defs.hasOwnProperty(i)) {
                def = defs[i];
                imp = def.imports.length ? ', ["' + def.imports.join('", "') + '"]' : '';
                str += (comment && (def.comment || '') + '\n' || '') + 'define("' + def.name + '"' + imp + ", " + def.content;
            }
        }
        return str;
    }

    function aryToKeys(ary) {
        var values;
        if (ary && ary.map) {
            values = {};
            ary.map(function (key) {
                values[key] = true;
            });
        } else if (ary) {
            values = ary;
        } else {
            values = {};
        }
        return values;
    }

    /**
     * @param {String} content
     * @param {{
         *  mangle:String,
         *  comment:Boolean=false
         * }=} options
     */
    this.optimizeAMD = function (content, options) {
        options = options || {};
        options.mangle = options.mangle || 'shorten';
        var o = new Optimizer();
        var defs = o.run(content, extract, options.mangle);
        return defsJoin(defs, options.comment);
    };

    /**
     *
     * @param {String} content
     * @param {{
         *   keep:Array.<String>,
         *   remove:Array.<Strings>|*,
         *   compare:Array.<Strings>|*,
         *   removeDuplicates:Boolean=true,
         *   removeUseStrict:Boolean=false
         * }=} options
     */
    this.treeshakeAMD = function (content, options) {
        var defs,
            /**
             * hash of true if they are used.
             * false if not
             * if false and not in keep. It gets dropped.
             * @type {{}}
             */
            used = {},
            cacheByContent = {},
            renameAlias = {},
            i;
        options = options || {};
        options.keep = aryToKeys(options.keep);
        options.remove = aryToKeys(options.remove);
        options.compare = options.compare ? extract(options.compare) : {};
        options.removeDuplicates = options.removeDuplicates !== false;
        options.removeUseStrict = options.removeUseStrict || false;

        if (options.removeUseStrict) {
            content = removeUseStrict(content);
        }
        defs = extract(content);
        removeUnusedImports(defs);
        gatherAliasNames(defs, renameAlias);
        replaceAllAliasNames(defs, renameAlias);

        if (options.removeDuplicates) {
            lookForDuplicateContents(defs, renameAlias, cacheByContent);
            replaceAllAliasNames(defs, renameAlias);
        }

        for (i in defs) {
            if (defs.hasOwnProperty(i) && defs[i].imports && !options.remove[i]) {
                findUsages(defs, i, used, options.keep, options.remove, []);
            }
        }
        console.log('used', used);
        for (i in defs) {
            if (defs.hasOwnProperty(i) && (options.compare[i] || !used[i]) && !options.keep[i]) {
                delete defs[i];
            }
        }
        return defsJoin(defs);
    };

    function findUsages(defs, key, used, keeps, removes, path) {
        if (keeps[key] || used[key]) {
            used[key] = true;
            console.log((keeps[key] ? "keep " : "used ") + key);
            return true;
        }
        var p;
        for (var i in defs) {
            p = path.slice();
            p.unshift(i);
            if (defs.hasOwnProperty(i) && i !== key && !removes[key] && defs[i].imports.indexOf(key) !== -1 && findUsages(defs, i, used, keeps, removes, p)) {
                console.log(p.join(' => ') + "::" + key);
                used[key] = true;
                return true;
            }
        }
        return false;
    }

    function lookForDuplicateContents(defs, renameAlias, cacheByContent) {
        // look for duplicate definitions with different names.
        for (var i in defs) {
            if (defs.hasOwnProperty(i)) {
                var k = defs[i].content;
                if (cacheByContent[k] && k !== defs[i].name) {
                    console.warn("Duplicate content, replacing " + defs[i].name + " with " + cacheByContent[k].name);
                    renameAlias[defs[i].name] = cacheByContent[k].name;
                    delete defs[i];
                } else {
                    cacheByContent[k] = defs[i];
                }
            }
        }
    }

    function removeUnusedImports(defs) {
        for(var i in defs) {
            if(defs.hasOwnProperty(i)) {
                removeUnusedImportsForDef(defs[i]);
            }
        }
    }

    function removeUnusedImportsForDef(def) {
        for (var i = 0; i < def.imports.length; i += 1) {
            var imp = def.imports[i];
            var args = def.content.match(/function\s?\((.*?)\)/);
            var arg = args && args[1].replace(/\s+/g, '').split(',')[i];
            var rx = new RegExp(arg + "(\\(|\\[|\\.)+");
            if (!def.content.match(rx)) {
                console.log('%cunfound use of "' + arg + '" in ' + def.name, 'color:#C00');
                console.log("replacing " + imp);
                def.imports.splice(i, 1);
                def.content = def.content.replace(/(function\s?)\((.*?)\)/, function (m, g1, g2) {
                    var args = g2.split(',');
                    args.splice(i, 1);
                    return g1 + '(' + args.join(', ') + ')';
                });
                i -= 1;
            } else {
                console.log('%cfound use of "' + arg + '" in ' + def.name, 'color:#090');
            }
        }
    }


    function removeUseStrict(str) {
        return str.replace(/\s+("|')use strict\1;/ig, '');
    }

    function gatherAliasNames(defs, renameAlias) {
        for (var i in defs) {
            if (defs.hasOwnProperty(i) && defs[i].alias) {
                renameAlias[defs[i].name] = defs[i].alias;
                defs[defs[i].alias] = defs[i];
                defs[i].name = defs[i].alias;
                delete defs[i].alias;
                delete defs[i];
            }
        }
    }

    function replaceAllAliasNames(defs, renameAlias) {
        // replace all aliasNames.
        var i, n, index;
        for (n in renameAlias) {
            if(renameAlias.hasOwnProperty(n)) {
                for (i in defs) {
                    if (defs.hasOwnProperty(i) && ((index = defs[i].imports.indexOf(n)) !== -1)) {
                        console.log("%creplacing alias " + n + " with " + renameAlias[n], "color:#F60");
                        defs[i].imports[index] = renameAlias[n];// now duplicate imports are renamed to the first alias.
                    }
                }
            }
        }

        for (n in renameAlias) {
            if (renameAlias.hasOwnProperty(i)) {
                delete renameAlias[i];
            }
        }
    }

}