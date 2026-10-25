function toCamel(obj) {
  if (Array.isArray(obj)) {
    return obj.map(toCamel);
  }

  if (obj !== null && typeof obj === 'object') {
    if (obj instanceof Date) return obj;

    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      acc[camelKey] = toCamel(obj[key]);
      return acc;
    }, {});
  }

  return obj;
}

module.exports = { toCamel };
