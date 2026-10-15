import {
  APP_TYPE_KEYS,
  BasicRetroAppWrapper,
  LOG
} from '@webrcade/app-common';

export class Emulator extends BasicRetroAppWrapper {

  GAME_SRAM_NAME = 'game.srm';
  SAVE_NAME = 'sav';

 constructor(app, debug = false) {
    super(app, debug);
    window.emulator = this;

    // Light gun (via mouse) state. Position is normalized to PicoDrive's
    // internal screen space (320x224 - matches draw_pico_ptr()'s hardcoded
    // 224 divisor for the crosshair; PicoPortUpdate()'s 0-240 clamp still
    // accepts this fine, it just never reaches the top of its range).
    this.mouseX = 160;
    this.mouseY = 112;
    this.mouseButtons = 0;

    document.addEventListener('mousemove', (e) => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      if (x < 0) x = 0;
      if (y < 0) y = 0;
      if (x > rect.width) x = rect.width;
      if (y > rect.height) y = rect.height;
      this.mouseX = Math.round((x / rect.width) * 320);
      this.mouseY = Math.round((y / rect.height) * 224);
    });

    // Matches PicoDrive's own Menacer/Justifier mapping: Left=A(trigger), Middle=B, Right=START
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseButtons |= 1;      // left: trigger
      else if (e.button === 1) this.mouseButtons |= 2; // middle: secondary
      else if (e.button === 2) this.mouseButtons |= 4; // right: third button

      // if (this.canvas) {
      //   const rect = this.canvas.getBoundingClientRect();
      //   console.log(
      //     `WRC_DEBUG: click at clientX=${e.clientX} clientY=${e.clientY} ` +
      //     `rect=[${rect.left},${rect.top},${rect.width},${rect.height}] ` +
      //     `-> mouseX=${this.mouseX} mouseY=${this.mouseY}`
      //   );
      // }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseButtons &= ~1;
      else if (e.button === 1) this.mouseButtons &= ~2;
      else if (e.button === 2) this.mouseButtons &= ~4;
    });

    // Don't let a right-click (secondary gun button) pop the browser menu
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  getScriptUrl() {
    return 'js/picodrive_libretro.js';
  }

  onFrame() {
    // Touch/mouse/keyboard interaction detection + on-screen touch overlay
    // gating is inherited from BasicRetroAppWrapper. This app has no other
    // per-frame work of its own.
    super.onFrame();
  }

  // Base class default pauses on any tap anywhere on screen -- redundant
  // (and disruptive) now that there's a dedicated Pause button in the
  // touch overlay. Same override every other TouchOverlay app uses for
  // the same reason.
  createTouchListener() {}

  // WRC - Genesis/32X's real controller has no analog trigger at all (the
  // 6-button pad's extra face buttons map to LBUMP/RBUMP above, not
  // LTRIG/RTRIG), so there's no real extended-hold function that could
  // collide with the LT+LA pause combo - see docs/escape-hack-audit.md's
  // decision rule. Previously left at the inherited `true` default, which
  // meant holding the pause combo itself for more than ~1s would silently
  // fail to open Pause.
  isEscapeHackEnabled() {
    return false;
  }

  getPort2() {
    const port2 = this.getProps().port2;
    return port2 !== undefined ? port2 : 0;
  }

  getMouseX() {
    return this.mouseX;
  }

  getMouseY() {
    return this.mouseY;
  }

  getMouseButtons() {
    return this.mouseButtons;
  }

  is3Button() {
    const props = this.getProps();
    return props.pad3button !== undefined && props.pad3button === true;
  }

  reportNon32XContent() {
    this.getApp().exit('This does not appear to be Sega 32X content.');
  }

  getHashFileExtension() {
    const type = this.getProps().type;
    if (type === APP_TYPE_KEYS.RETRO_PICODRIVE_32XCD) return 'chd';
    return '32x';
  }

  async saveState() {
    const { saveStatePath, started } = this;
    const { FS, Module } = window;

    try {
      if (!started) {
        return;
      }

      // Save to files
      Module._cmd_savefiles();

      let path = '';
      const files = [];
      let s = null;

      path = `/home/web_user/retroarch/userdata/saves/${this.GAME_SRAM_NAME}`;
      LOG.info('Checking: ' + path);
      try {
        s = FS.readFile(path);
        if (s) {
          LOG.info('Found save file: ' + path);
          let hasData = false;
          for (let i = 0; i < s.length; i++) {
            if (s[i] !== 0xFF) {
              hasData = true;
              break; // exit early
            }
          }

          if (hasData) {
            LOG.info('File has content: ' + path);
            files.push({
              name: this.SAVE_NAME,
              content: s,
            });
          } else {
            LOG.info('Skipping empty file: ' + path);
          }
        }
      } catch (e) {}

      if (files.length > 0) {
        if (await this.getSaveManager().checkFilesChanged(files)) {
          await this.getSaveManager().save(
            saveStatePath,
            files,
            this.saveMessageCallback,
          );
        }
      } else {
        await this.getSaveManager().delete(path);
      }
    } catch (e) {
      LOG.error('Error persisting save state: ' + e);
    }
  }

  async loadState() {
    const { saveStatePath } = this;
    const { FS } = window;

    // Write the save state (if applicable)
    try {
      // Load
      const files = await this.getSaveManager().load(
        saveStatePath,
        this.loadMessageCallback,
      );

      if (files) {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (f.name === this.SAVE_NAME) {
            LOG.info(`writing ${this.GAME_SRAM_NAME} file`);
            FS.writeFile(
              `/home/web_user/retroarch/userdata/saves/${this.GAME_SRAM_NAME}`,
              f.content,
            );
          }
        }

        // Cache the initial files
        await this.getSaveManager().checkFilesChanged(files);
      }
    } catch (e) {
      LOG.error('Error loading save state: ' + e);
    }
  }

  isForceAspectRatio() {
    return false;
  }

  getDefaultAspectRatio() {
    return 4 / 3;
  }

  resizeScreen(canvas) {
    this.canvas = canvas;
    this.updateScreenSize();
  }

  getShotAspectRatio() { return this.getDefaultAspectRatio(); }
}
