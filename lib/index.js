'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

exports.default = init;

var _uberproto = require('uberproto');

var _uberproto2 = _interopRequireDefault(_uberproto);

var _feathersQueryFilters = require('feathers-query-filters');

var _feathersQueryFilters2 = _interopRequireDefault(_feathersQueryFilters);

var _feathersErrors = require('feathers-errors');

var _parse = require('./parse');

var _parse2 = _interopRequireDefault(_parse);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// Create the service.
var Service = function () {
  function Service(options) {
    _classCallCheck(this, Service);

    if (!options) {
      throw new Error('RethinkDB options have to be provided.');
    }

    if (options.Model) {
      options.r = options.Model;
    } else {
      throw new Error('You must provide the RethinkDB object on options.Model');
    }

    // Make sure the user connected a database before creating the service.
    if (!options.r._poolMaster._options.db) {
      throw new Error('You must provide either an instance of r that is preconfigured with a db, or a provide options.db.');
    }

    if (!options.name) {
      throw new Error('You must provide a table name on options.name');
    }

    this.type = 'rethinkdb';
    this.id = options.id || 'id';
    this.table = options.r.table(options.name);
    this.options = options;
    this.paginate = options.paginate || {};
    this.events = ['created', 'updated', 'patched', 'removed'];
  }

  _createClass(Service, [{
    key: 'extend',
    value: function extend(obj) {
      return _uberproto2.default.extend(obj, this);
    }
  }, {
    key: '_find',
    value: function _find() {
      var _this = this;

      var params = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

      var r = this.options.r;

      params.query = params.query || {};

      // Start with finding all, and limit when necessary.
      var query = this.table.filter({});
      // Prepare the special query params.
      var filters = (0, _feathersQueryFilters2.default)(params.query, this.paginate);

      // Handle $select
      if (filters.$select) {
        query = query.pluck(filters.$select);
      }

      // Handle $sort
      if (filters.$sort) {
        var fieldName = Object.keys(filters.$sort)[0];
        if (filters.$sort[fieldName] === 1) {
          query = query.orderBy(fieldName);
        } else {
          query = query.orderBy(r.desc(fieldName));
        }
      }

      // Handle $or
      // TODO (@marshallswain): Handle $or queries with nested specials.
      // Right now they won't work and we'd need to start diving
      // into nested where conditions.
      if (params.query.$or) {
        (function () {
          // orQuery will be built and passed to row('rowName').filter().
          var orQuery = void 0;
          // params.query.$or looks like [ { name: 'Alice' }, { name: 'Bob' } ]
          // Needs to become:
          // r.row("name").eq('Alice').or(r.row("name").eq('Bob'))
          params.query.$or.forEach(function (queryObject, i) {
            // queryObject looks like { name: 'Alice' }
            var keys = Object.keys(queryObject);

            keys.forEach(function (qField) {
              // The queryObject's value: 'Alice'
              var qValue = queryObject[qField];

              // Build the subQuery based on the qField.
              var subQuery = void 0;
              // If the qValue is an object, it will have special params in it.
              if ((typeof qValue === 'undefined' ? 'undefined' : _typeof(qValue)) !== 'object') {
                subQuery = r.row(qField).eq(qValue);
              }

              // At the end of the current set of attributes, determine placement.
              if (i === 0) {
                orQuery = subQuery;
              } else {
                orQuery = orQuery.or(subQuery);
              }
            });
          });

          query = query.filter(orQuery);
          delete params.query.$or;
        })();
      }
      query = (0, _parse2.default)(this, query, params.query);

      var countQuery = void 0;

      // Handle $search
      if (filters.$search) {
        var key = Object.keys(filters.$search)[0];
        var value = filters.$search[key];
        query = query.filter(function (node) {
          return node('' + key).match('^.*?' + value + '.*$');
        });
      }

      // For pagination, count has to run as a separate query, but without limit.
      if (this.paginate.default) {
        countQuery = query.count().run();
      }

      // Handle $skip AFTER the count query but BEFORE $limit.
      if (filters.$skip) {
        query = query.skip(filters.$skip);
      }
      // Handle $limit AFTER the count query and $skip.
      if (filters.$limit) {
        query = query.limit(filters.$limit);
      }

      // Execute the query
      return Promise.all([query, countQuery]).then(function (_ref) {
        var _ref2 = _slicedToArray(_ref, 2);

        var data = _ref2[0];
        var total = _ref2[1];

        if (_this.paginate.default) {
          return {
            total: total,
            data: data,
            limit: filters.$limit,
            skip: filters.$skip || 0
          };
        }

        return data;
      });
    }
  }, {
    key: 'find',
    value: function find() {
      return this._find.apply(this, arguments);
    }
  }, {
    key: '_get',
    value: function _get(id, params) {
      var query = void 0;
      // If an id was passed, just get the record.
      if (id !== null && id !== undefined) {
        query = this.table.get(id);

        // If no id was passed, use params.query
      } else {
        params = params || {
          query: {}
        };
        query = this.table.filter(params.query).limit(1);
      }

      return query.run().then(function (data) {
        if (Array.isArray(data)) {
          data = data[0];
        }
        if (!data) {
          throw new _feathersErrors.types.NotFound('No record found for id \'' + id + '\'');
        }
        return data;
      });
    }
  }, {
    key: 'get',
    value: function get() {
      return this._get.apply(this, arguments);
    }

    // STILL NEED TO ADD params argument here.

  }, {
    key: 'create',
    value: function create(data) {
      return this.table.insert(data).run().then(function (res) {
        return Object.assign({
          id: data.id ? data.id : res.generated_keys[0]
        }, data);
      });
    }
  }, {
    key: 'patch',
    value: function patch(id, data, params) {
      var _this2 = this;

      var query = void 0;

      if (id !== null && id !== undefined) {
        query = this._get(id);
      } else if (params) {
        query = this._find(params);
      } else {
        return Promise.reject(new Error('Patch requires an ID or params'));
      }

      // Find the original record(s), first, then patch them.
      return query.then(function (getData) {
        var query = void 0;
        if (Array.isArray(getData)) {
          var _table;

          query = (_table = _this2.table).getAll.apply(_table, _toConsumableArray(getData.map(function (item) {
            return item.id;
          })));
        } else {
          query = _this2.table.get(id);
        }

        return query.update(data, {
          returnChanges: true
        }).run().then(function (response) {
          var changes = response.changes.map(function (change) {
            return change.new_val;
          });
          return changes.length === 1 ? changes[0] : changes;
        });
      });
    }
  }, {
    key: 'update',
    value: function update(id, data) {
      var _this3 = this;

      return this._get(id).then(function (getData) {
        data.id = id;

        return _this3.table.get(getData.id).replace(data, {
          returnChanges: true
        }).run().then(function (result) {
          return result.changes && result.changes.length ? result.changes[0].new_val : {};
        });
      });
    }
  }, {
    key: 'remove',
    value: function remove(id, params) {
      var query = void 0;

      // You have to pass id=null to remove all records.
      if (id !== null && id !== undefined) {
        query = this.table.get(id);
      } else if (id === null) {
        var queryParams = Object.assign({}, params && params.query);
        query = this.table.filter(queryParams);
      } else {
        return Promise.reject(new Error('You must pass either an id or params to remove.'));
      }

      return query.delete({
        returnChanges: true
      }).run().then(function (res) {
        if (res.changes && res.changes.length) {
          var changes = res.changes.map(function (change) {
            return change.old_val;
          });
          return changes.length === 1 ? changes[0] : changes;
        } else {
          return [];
        }
      });
    }
  }, {
    key: 'setup',
    value: function setup() {
      var _this4 = this;

      this._cursor = this.table.changes().run().then(function (cursor) {
        cursor.each(function (error, data) {
          if (error || typeof _this4.emit !== 'function') {
            return;
          }

          if (data.old_val === null) {
            _this4.emit('created', data.new_val);
          } else if (data.new_val === null) {
            _this4.emit('removed', data.old_val);
          } else {
            _this4.emit('updated', data.new_val);
            _this4.emit('patched', data.new_val);
          }
        });

        return cursor;
      });
    }
  }]);

  return Service;
}();

function init(options) {
  return new Service(options);
}

init.Service = Service;
module.exports = exports['default'];