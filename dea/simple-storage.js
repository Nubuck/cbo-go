import fs from 'fs';
import path from 'path';

class SimpleStorage {
  constructor(options = {}) {
    this.dir = options.dir || path.join(process.cwd(), 'storage');
    this.filename = path.join(this.dir, 'auth-storage.json');
    this.encoding = options.encoding || 'utf8';
    
    // Ensure storage directory exists
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    
    // Initialize storage file if it doesn't exist
    if (!fs.existsSync(this.filename)) {
      this._writeFile({});
    }
  }

  _readFile() {
    try {
      const data = fs.readFileSync(this.filename, this.encoding);
      return JSON.parse(data || '{}');
    } catch (error) {
      console.warn(`[SimpleStorage] Error reading storage file, returning empty object:`, error.message);
      // If file is corrupted, reset to empty object
      this._writeFile({});
      return {};
    }
  }

  _writeFile(data) {
    try {
      // Use atomic write - write to temp file first, then rename
      const tempFile = this.filename + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), this.encoding);
      fs.renameSync(tempFile, this.filename);
    } catch (error) {
      console.error(`[SimpleStorage] Error writing storage file:`, error.message);
      throw error;
    }
  }

  getItem(key) {
    try {
      const data = this._readFile();
      return data[key] || null;
    } catch (error) {
      console.error(`[SimpleStorage] Error getting item '${key}':`, error.message);
      return null;
    }
  }

  setItem(key, value) {
    try {
      const data = this._readFile();
      data[key] = value;
      this._writeFile(data);
    } catch (error) {
      console.error(`[SimpleStorage] Error setting item '${key}':`, error.message);
      throw error;
    }
  }

  removeItem(key) {
    try {
      const data = this._readFile();
      delete data[key];
      this._writeFile(data);
    } catch (error) {
      console.error(`[SimpleStorage] Error removing item '${key}':`, error.message);
      throw error;
    }
  }

  clear() {
    try {
      this._writeFile({});
    } catch (error) {
      console.error(`[SimpleStorage] Error clearing storage:`, error.message);
      throw error;
    }
  }

  // Additional utility methods for debugging
  keys() {
    try {
      const data = this._readFile();
      return Object.keys(data);
    } catch (error) {
      console.error(`[SimpleStorage] Error getting keys:`, error.message);
      return [];
    }
  }

  size() {
    try {
      const data = this._readFile();
      return Object.keys(data).length;
    } catch (error) {
      console.error(`[SimpleStorage] Error getting size:`, error.message);
      return 0;
    }
  }
}

export default SimpleStorage;