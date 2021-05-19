import { readdir, open, FileHandle } from 'fs/promises';
import { statSync, watch, FSWatcher } from 'fs';
import { join } from 'path';
import EventEmitter from 'events';

export class Journal extends EventEmitter {
  static DEFAULT_JOURNAL_FOLDER_WINDOWS = join(
    process.env.USERPROFILE || '',
    '/Saved Games/Frontier Developments/Elite Dangerous'
  );
  static DEFAULT_JOURNAL_FOLDER_LINUX = join(
    process.env.HOME || '',
    '/.steam/steam/steamapps/compatdata/359320/pfx/drive_c/users/steamuser/Saved Games/Frontier Developments/Elite Dangerous/'
  );
  static DEFAULT_JOURNAL_FOLDER_OSX = join(
    process.env.HOME || '',
    '/Library/Application Support/Steam/steamapps/compatdata/359320/pfx/drive_c/users/steamuser/Saved Games/Frontier Developments/Elite Dangerous/'
  );
  folder: string;
  currentFileName: string;
  nextFileName: string;
  currentFile: FileHandle;
  currentFileReader: () => Promise<void>;
  fileWatcher: FSWatcher;
  dirWatcher: FSWatcher;
  constructor(folder: string = null) {
    super();
    if (folder !== null) {
      this.folder = folder;
    } else {
      switch (process.platform) {
        case 'win32': {
          this.folder = Journal.DEFAULT_JOURNAL_FOLDER_WINDOWS;
          break;
        }
        case 'linux': {
          this.folder = Journal.DEFAULT_JOURNAL_FOLDER_LINUX;
          break;
        }
        case 'darwin': {
          this.folder = Journal.DEFAULT_JOURNAL_FOLDER_OSX;
          break;
        }
        default: {
          throw new Error("Unhandled OS, No Default Journal Location");
        }
      }
    }
    statSync(this.folder);
    this.loadLatestFile();
    this.on('event', (event) => {
      if (event.event === 'Continued') {
        this.fileWatcher.close();
        this.currentFile.close();
        this.loadLatestFile();
      }
    });
    this.dirWatcher = watch(join(this.folder), undefined, () => {
      this.getLatestFilename();
    });
  }
  async getLatestFilename() {
    const files = (await readdir(this.folder, { encoding: 'utf8', withFileTypes: true }))
      .filter((dirent) => { return dirent.isFile() && dirent.name.startsWith("Journal."); })
      .map((dirent) => { return dirent.name; })
      .sort((a, b) => { return a.localeCompare(b); });
    const latest = files.pop();
    if (!this.nextFileName && this.currentFileName !== latest) {
      this.nextFileName = latest;
      if (this.currentFileReader) this.currentFileReader();
    }
  }
  async loadLatestFile() {
    if (this.nextFileName === undefined) {
      await this.getLatestFilename();
    }
    this.currentFileName = this.nextFileName;
    this.nextFileName = undefined;
    await this.openFile();
  }
  async openFile() {
    this.currentFile = await open(join(this.folder, this.currentFileName), 'r');
    let tmp = '';
    let reading = false;
    this.currentFileReader = async () => {
      if (reading) return;
      reading = true;
      while (true) {
        const { bytesRead, buffer } = await this.currentFile.read(Buffer.alloc(16384), 0, 16384, null);
        if (bytesRead === 0) {
          reading = false;
          if (this.nextFileName && this.currentFileName !== this.nextFileName) {
            this.fileWatcher.close();
            this.currentFile.close();
            this.loadLatestFile();
          }
          return;
        }
        const lines = (tmp + (buffer.slice(0, bytesRead).toString('utf8'))).split("\r\n");
        tmp = lines.pop();
        lines.forEach((line) => {
          this.parseLine(line);
        });
      }
    };
    this.fileWatcher = watch(join(this.folder, this.currentFileName), undefined, (event, filename) => {
      this.currentFileReader();
    });
    await this.currentFileReader();
  }
  parseLine(line: string) {
    try {
      const data: JournalEvent = JSON.parse(line);
      this.emit('event', data);
      this.emit(data.event, data);
    } catch (err) {
      this.emit('error', err);
    }
  }
}

export type JournalEvent = {
  timestamp: string,
  event: string,
  [string: string]: any
}
