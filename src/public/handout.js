(function () {
  "use strict";

  // Theme switch — the one behaviour with no no-JS equivalent.
  function initTheme() {
    var buttons = document.querySelectorAll("[data-theme-button]");
    if (buttons.length === 0) return;

    function currentTheme() {
      try {
        return localStorage.getItem("handout-theme") || "system";
      } catch {
        return "system";
      }
    }

    function applyButtons(theme) {
      buttons.forEach(function (button) {
        var isActive = button.getAttribute("data-theme-button") === theme;
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
        var check = button.querySelector("[data-theme-check]");
        if (check) check.textContent = isActive ? "✓" : "";
      });
    }

    function setTheme(theme) {
      try {
        localStorage.setItem("handout-theme", theme);
      } catch {
        // ignore
      }
      if (theme === "light" || theme === "dark") {
        document.documentElement.setAttribute("data-theme", theme);
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
      applyButtons(theme);
    }

    applyButtons(currentTheme());
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        setTheme(button.getAttribute("data-theme-button"));
      });
    });
  }

  // Profile panel.
  function initProfilePanel() {
    var toggle = document.querySelector("[data-profile-toggle]");
    var panel = document.querySelector("[data-profile-panel]");
    if (!toggle || !panel) return;

    function close() {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }

    function open() {
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    }

    toggle.addEventListener("click", function () {
      if (panel.hidden) open();
      else close();
    });

    document.addEventListener("pointerdown", function (event) {
      if (
        !panel.hidden &&
        !panel.contains(event.target) &&
        event.target !== toggle
      ) {
        close();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !panel.hidden) close();
    });
  }

  // Clipboard copy. Every [data-copy-button] on the page gets its own
  // handle: the result page carries two (address, password), and each has
  // to show its own receipt independently of the other.
  function initCopy() {
    var buttons = document.querySelectorAll("[data-copy-button]");

    buttons.forEach(function (button) {
      // The label is its own element next to the reserved ones that hold the
      // button's width, so only the label's text may be replaced — writing to
      // the button itself would throw the reserves away and the width with
      // them. The fallback keeps a button without the stack working.
      var labelEl = button.querySelector("[data-copy-label]") || button;

      function showConfirmation(label) {
        var original = labelEl.textContent;
        labelEl.textContent = label;
        setTimeout(function () {
          labelEl.textContent = original;
        }, 2000);
      }

      button.addEventListener("click", function () {
        var field = button.closest("[data-copy]");
        if (!field) return;
        var failedLabel = button.getAttribute("data-copy-failed-label");

        if (!navigator.clipboard) {
          showConfirmation(failedLabel);
          return;
        }

        var value = field.getAttribute("data-copy");
        navigator.clipboard.writeText(value).then(
          function () {
            showConfirmation(button.getAttribute("data-copied-label"));
          },
          function () {
            // The clipboard write can reject (insecure context, revoked
            // permission); silence here would be exactly the "copied
            // twice, pasted into nothing" failure the confirmation exists
            // to prevent.
            showConfirmation(failedLabel);
          },
        );
      });
    });
  }

  // The combined address+password handle has no no-JavaScript equivalent —
  // there is no clipboard without a script — so it is rendered `hidden` on
  // the server and this reveals it once initCopy() has wired it up. Address
  // and password stay readable and selectable in their own rows regardless,
  // with or without this running.
  function initCopyMessage() {
    var rows = document.querySelectorAll("[data-copy-message-row]");
    rows.forEach(function (row) {
      row.hidden = false;
    });
  }

  // The protect checkbox toggles the password block's `hidden` property,
  // and runs once on load so the server-rendered state and the DOM agree.
  function initProtectToggle() {
    var checkbox = document.getElementById("protect");
    var block = document.querySelector("[data-password-block]");
    if (!checkbox || !block) return;

    function apply() {
      block.hidden = !checkbox.checked;
    }

    checkbox.addEventListener("change", apply);
    apply();
  }

  // The dashboard row's `⋯` menu. Returns immediately when the dashboard is
  // not the page rendered, so nothing else here is touched.
  function initRowMenu() {
    var toggles = document.querySelectorAll("[data-row-menu-toggle]");
    if (toggles.length === 0) return;

    var openMenu = null;
    var openToggle = null;
    var closeTimer = null;

    // Only one menu is open at a time, so one pending auto-close timer is
    // always enough — but it must be cancelled here, on every path that
    // closes a menu (a second toggle, a click outside, Escape, and this
    // timer's own callback), not only where it was started. Without this,
    // a timer scheduled for row A by its own "Copy password" click keeps
    // running after A is closed some other way, and later fires against
    // whatever row is open by then — closing row B's menu out from under
    // someone who just opened it.
    function closeMenu() {
      clearTimeout(closeTimer);
      closeTimer = null;
      if (!openMenu) return;
      openMenu.hidden = true;
      openMenu.classList.remove("handout-row-menu-up");
      if (openToggle) openToggle.setAttribute("aria-expanded", "false");
      openMenu = null;
      openToggle = null;
    }

    toggles.forEach(function (toggle) {
      // This is what makes the handle exist at all: there is no clipboard
      // without a script, so the toggle stays `hidden` until this runs.
      toggle.hidden = false;

      var menu = document.getElementById(toggle.getAttribute("aria-controls"));
      if (!menu) return;

      toggle.addEventListener("click", function () {
        if (openMenu === menu) {
          closeMenu();
          return;
        }
        // Only one menu open at a time.
        closeMenu();
        menu.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        openMenu = menu;
        openToggle = toggle;

        // Flip-up: measure the menu's own rendered height rather than
        // copying the component's constants, which count menu items this
        // story does not build.
        var rect = toggle.getBoundingClientRect();
        var up = rect.bottom + menu.offsetHeight > window.innerHeight;
        menu.classList.toggle("handout-row-menu-up", up);
      });

      menu.querySelectorAll("[data-copy-button]").forEach(function (item) {
        item.addEventListener("click", function () {
          // The receipt shows for 2000 ms in initCopy(); closing the menu
          // after 1000 ms lets the publisher see it for the first second,
          // then gets the menu out of the way — the component's own
          // behaviour, kept.
          clearTimeout(closeTimer);
          closeTimer = setTimeout(closeMenu, 1000);
        });
      });

      // HandoutZeile.dc.html's own onPick: `this.setState({ menu: false })`,
      // unconditionally, before anything else runs. Without this the menu —
      // 292px wide — stays open for the whole transfer and, on a narrow
      // viewport where the row wraps, sits right on top of the progress
      // panel and the refusal message below it.
      var fileInput = menu.querySelector("[data-row-file-input]");
      if (fileInput) {
        fileInput.addEventListener("change", closeMenu);
      }

      // The component's toggleEntry sets `menu: false` first thing too —
      // the panel takes the menu's place in the row, so the menu itself
      // must not still be sitting open above it.
      var entryItem = menu.querySelector("[data-row-entry-item]");
      if (entryItem) {
        entryItem.addEventListener("click", closeMenu);
      }

      // The component's askDelete sets `menu: false` first thing too — the
      // item closes the menu and then opens the dialog.
      var deleteItem = menu.querySelector("[data-row-delete]");
      if (deleteItem) {
        deleteItem.addEventListener("click", closeMenu);
      }
    });

    document.addEventListener("pointerdown", function (event) {
      if (!openMenu) return;
      if (
        !openMenu.contains(event.target) &&
        event.target !== openToggle &&
        !(openToggle && openToggle.contains(event.target))
      ) {
        closeMenu();
      }
    });

    // Not in the component — a deliberate addition mirroring
    // initProfilePanel(), the one other popover in the product.
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && openMenu) closeMenu();
    });
  }

  // Rewrites each "last state" stamp from the server's UTC text to the
  // device's own time zone. Without JavaScript, or when Intl is missing or
  // the value unparseable, the server's text — which names its zone — is
  // left standing rather than replaced with a bare one.
  var localStampDatePart, localStampTimePart;
  if (
    typeof Intl !== "undefined" &&
    typeof Intl.DateTimeFormat === "function"
  ) {
    localStampDatePart = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
    });
    localStampTimePart = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  }

  // Rewrites one "last state" stamp from the server's UTC text to the
  // device's own time zone. Without Intl, or with an unparseable value, the
  // server's text — which names its zone — is left standing rather than
  // replaced with a bare one. Split out of initLocalStamps() so a row's
  // stamp can be re-rendered on its own once an update finishes, without
  // re-scanning the whole page.
  function applyLocalStamp(el) {
    if (!localStampDatePart) return;
    var date = new Date(el.getAttribute("datetime"));
    if (isNaN(date.getTime())) return;
    el.textContent =
      localStampDatePart.format(date) + ", " + localStampTimePart.format(date);
  }

  function initLocalStamps() {
    var stamps = document.querySelectorAll("[data-local-stamp]");
    stamps.forEach(applyLocalStamp);
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
      var mb = (bytes / (1024 * 1024)).toFixed(1);
      if (mb.slice(-2) === ".0") mb = mb.slice(0, -2);
      return mb + " MB";
    }
    return Math.round(bytes / 1024) + " KB";
  }

  function substitute(template, values) {
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      return Object.prototype.hasOwnProperty.call(values, name)
        ? values[name]
        : match;
    });
  }

  // The row's own refusal reporter — one implementation shared by the row
  // upload (initRowUpload) and the entry panel (initRowEntry), both of
  // which report into the same row-level slot the row upload already
  // established. Returns a show(text) closure; an empty text clears it.
  function rowMessage(list, row) {
    var messageBox = row.querySelector("[data-row-upload-message]");
    var box = row.querySelector("[data-row-upload-box]");

    return function show(text) {
      messageBox.textContent = "";
      if (!text) {
        messageBox.hidden = true;
        return;
      }
      var icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.className = "handout-row-message-icon";
      icon.textContent = list.getAttribute("data-message-icon") || "";
      messageBox.appendChild(icon);
      messageBox.appendChild(document.createTextNode(text));
      messageBox.hidden = false;
      if (box) box.hidden = true;
    };
  }

  // The path filter behind both the entry-choice screen (initEntryChoice)
  // and the row's entry panel (initRowEntry) — one implementation of the
  // design's "filtering never discards the selection" rule, kept verbatim
  // for its one existing caller and given a second one here rather than
  // duplicated.
  // Binds the `input` listener exactly once — the caller may still hand it
  // a fresh `radios` array later (setRadios), which the row's entry panel
  // does on every open, without adding a second listener: rebinding on every
  // rebuild would stack one more "input" handler per open, each still
  // holding its own now-detached radio list through its closure.
  function bindPathFilter(opts) {
    var input = opts.input;
    var countSpan = opts.countSpan;
    var noMatch = opts.noMatch;
    var rowFor = opts.rowFor;
    var radios = opts.radios;

    function update() {
      var needle = input.value.trim().toLowerCase();
      var shown = 0;
      var pinned = false;
      var total = radios.length;

      radios.forEach(function (radio) {
        var candidateRow = rowFor(radio);
        var matches =
          !needle ||
          candidateRow.textContent.toLowerCase().indexOf(needle) !== -1;
        // The selected row is never hidden and never moved (docs/adr/0012,
        // D8): the design system's own rule is "filtering never discards the
        // selection", so a checked radio stays put and stays visible even
        // when the needle would otherwise exclude it — the component's own
        // implementation (which pins it back to the top of the list) is not
        // followed here, only its stated rule.
        if (radio.checked && !matches) {
          pinned = true;
          candidateRow.hidden = false;
          return;
        }
        candidateRow.hidden = !matches;
        if (matches) shown += 1;
      });

      if (countSpan) {
        var template = pinned
          ? countSpan.getAttribute("data-template-some-pinned")
          : shown === total
            ? countSpan.getAttribute("data-template-all")
            : countSpan.getAttribute("data-template-some");
        countSpan.textContent = substitute(template, {
          shown: shown,
          total: total,
        });
      }

      if (noMatch) noMatch.hidden = shown !== 0 || pinned;
    }

    input.addEventListener("input", update);

    return {
      update: update,
      setRadios: function (nextRadios) {
        radios = nextRadios;
      },
    };
  }

  // Drop area, title prefill, publish button state, upload.
  function initDropArea() {
    var form = document.querySelector("[data-publish-form]");
    var dropArea = document.querySelector("[data-drop-area]");
    if (!form || !dropArea) return;

    var fileInput = dropArea.querySelector("[data-file-input]");
    var pickButton = dropArea.querySelector("[data-pick]");
    var replaceButton = dropArea.querySelector("[data-replace]");
    var emptyState = dropArea.querySelector("[data-drop-empty]");
    var filledState = dropArea.querySelector("[data-drop-filled]");
    var filledName = dropArea.querySelector("[data-filled-name]");
    var filledSize = dropArea.querySelector("[data-filled-size]");
    var messageBox = dropArea.querySelector("[data-drop-message]");
    var titleInput = form.querySelector("[data-title-input]");
    var fieldBlock = form.querySelector("[data-field]");
    var protectCheckbox = form.querySelector("#protect");
    var passwordInput = form.querySelector("#password");
    var suggestButton = form.querySelector("[data-suggest-password]");
    var publishButton = form.querySelector("[data-publish-button]");
    var formCancel = form.querySelector("[data-form-cancel]");
    var uploadBox = form.querySelector("[data-upload-box]");
    var uploadFile = uploadBox
      ? uploadBox.querySelector("[data-upload-file]")
      : null;
    var uploadPercent = uploadBox
      ? uploadBox.querySelector("[data-upload-percent]")
      : null;
    var uploadFill = uploadBox
      ? uploadBox.querySelector("[data-upload-fill]")
      : null;
    var uploadCancelButton = uploadBox
      ? uploadBox.querySelector("[data-upload-cancel]")
      : null;

    var maxUploadBytes = Number(dropArea.getAttribute("data-max-upload-bytes"));
    var allowedExtensions = [".zip", ".html", ".htm", ".pdf"];

    var selectedFile = null;

    var serverMessage = document.querySelector("[data-server-message]");

    // Every message this script itself renders is about the file — the
    // browser never pre-checks the title — so showing one frames the drop
    // area the same way a server-rendered file refusal does, and clearing
    // one un-frames it. A stale red frame around a file that is now valid
    // is worse than no frame, so this also takes down whatever the server
    // rendered on the initial page load.
    function showMessage(text) {
      messageBox.textContent = "";
      if (serverMessage) serverMessage.hidden = true;
      if (!text) {
        messageBox.hidden = true;
        dropArea.classList.remove("error");
        return;
      }
      // The icon is aria-hidden and carries no information the text itself
      // does not already say in words — nothing here is conveyed by colour
      // alone.
      var icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.className = "drop-message-icon";
      icon.textContent = dropArea.getAttribute("data-message-icon") || "";
      messageBox.appendChild(icon);
      messageBox.appendChild(document.createTextNode(text));
      messageBox.hidden = false;
      dropArea.classList.add("error");
    }

    function extensionOf(name) {
      var match = /\.[a-z0-9]+$/i.exec(name);
      return match ? match[0].toLowerCase() : "";
    }

    function updatePublishButton() {
      if (!selectedFile) {
        publishButton.disabled = true;
        publishButton.textContent =
          publishButton.getAttribute("data-label-no-file");
      } else if (!titleInput.value.trim()) {
        publishButton.disabled = true;
        publishButton.textContent = publishButton.getAttribute(
          "data-label-no-title",
        );
      } else if (
        protectCheckbox &&
        protectCheckbox.checked &&
        passwordInput &&
        !passwordInput.value.trim()
      ) {
        publishButton.disabled = true;
        publishButton.textContent = publishButton.getAttribute(
          "data-label-no-password",
        );
      } else {
        publishButton.disabled = false;
        publishButton.textContent =
          publishButton.getAttribute("data-label-ready");
      }
    }

    function acceptFile(file) {
      showMessage("");

      if (file.size > maxUploadBytes) {
        showMessage(
          substitute(dropArea.getAttribute("data-too-large"), {
            size: formatBytes(file.size),
            limit: formatBytes(maxUploadBytes),
          }),
        );
        fileInput.value = "";
        selectedFile = null;
        updatePublishButton();
        return;
      }

      if (allowedExtensions.indexOf(extensionOf(file.name)) === -1) {
        showMessage(dropArea.getAttribute("data-unsupported"));
        fileInput.value = "";
        selectedFile = null;
        updatePublishButton();
        return;
      }

      selectedFile = file;
      filledName.textContent = file.name;
      filledSize.textContent = formatBytes(file.size);
      emptyState.hidden = true;
      filledState.hidden = false;

      if (!titleInput.value.trim()) {
        titleInput.value = file.name.replace(/\.[a-z0-9]+$/i, "");
      }

      updatePublishButton();
    }

    function clearFile() {
      selectedFile = null;
      fileInput.value = "";
      emptyState.hidden = false;
      filledState.hidden = true;
      updatePublishButton();
    }

    pickButton.addEventListener("click", function () {
      fileInput.click();
    });

    if (replaceButton) {
      replaceButton.addEventListener("click", clearFile);
    }

    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files[0]) {
        acceptFile(fileInput.files[0]);
      }
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
      dropArea.addEventListener(eventName, function (event) {
        event.preventDefault();
        dropArea.classList.add("dragging");
      });
    });
    ["dragleave", "drop"].forEach(function (eventName) {
      dropArea.addEventListener(eventName, function (event) {
        event.preventDefault();
        dropArea.classList.remove("dragging");
      });
    });
    dropArea.addEventListener("drop", function (event) {
      if (
        event.dataTransfer &&
        event.dataTransfer.files &&
        event.dataTransfer.files[0]
      ) {
        acceptFile(event.dataTransfer.files[0]);
      }
    });

    titleInput.addEventListener("input", updatePublishButton);

    if (protectCheckbox) {
      protectCheckbox.addEventListener("change", updatePublishButton);
    }
    if (passwordInput) {
      passwordInput.addEventListener("input", updatePublishButton);
    }
    if (suggestButton && passwordInput) {
      suggestButton.addEventListener("click", function () {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "/password-suggestion", true);
        xhr.setRequestHeader("Accept", "application/json");
        xhr.onload = function () {
          if (xhr.status < 200 || xhr.status >= 300) return;
          var response;
          try {
            response = JSON.parse(xhr.responseText);
          } catch {
            return;
          }
          if (response && response.password) {
            passwordInput.value = response.password;
            updatePublishButton();
          }
        };
        xhr.send();
      });
    }

    // Tracks the in-flight upload, if any, so the transfer-phase cancel
    // button — wired once, below, not once per submit — always aborts the
    // right request regardless of how many times the form was submitted
    // before it.
    var activeXhr = null;

    if (uploadCancelButton) {
      uploadCancelButton.addEventListener("click", function () {
        if (activeXhr) activeXhr.abort();
        // Navigate straight away rather than relying on xhr.onabort: that
        // handler exists to restore the form after an abort from
        // elsewhere, and running it here first would only flash the form
        // back before the navigation replaces it anyway.
        window.location.assign("/");
      });
    }

    form.addEventListener("submit", function (event) {
      if (!window.XMLHttpRequest || !selectedFile) return;
      event.preventDefault();

      var formData = new FormData(form);
      var xhr = new XMLHttpRequest();
      activeXhr = xhr;
      xhr.open("POST", form.action, true);
      xhr.setRequestHeader("Accept", "application/json");

      // The progress box takes the drop area's own place rather than
      // appearing somewhere else on the page: the drop area is the file's
      // slot here, so during the transfer that slot shows the transfer.
      // Hiding the drop area this way also makes drag-and-drop on it inert
      // for free — a hidden element receives no drag events — so dropping a
      // second file mid-upload has nothing to land on.
      //
      // The title field and the Publish button are hidden too, not
      // disabled: the title is already in the request by then, so an
      // editable field whose value no longer does anything is a small lie,
      // and a disabled field is a state the reader has to parse — neither
      // is what the design brief wants. Both sit below the slot, so hiding
      // them only removes content at the end of the form; nothing above
      // moves, so there is still no layout jump.
      dropArea.hidden = true;
      if (fieldBlock) fieldBlock.hidden = true;
      publishButton.hidden = true;
      // The form-phase cancel sits right next to the Publish button, which
      // is hidden for the duration of the transfer — hide this one with
      // it, or the page shows two cancel handles at once (this one and
      // the transfer-phase one below).
      if (formCancel) formCancel.hidden = true;
      if (uploadBox) {
        uploadBox.hidden = false;
        if (uploadFile)
          uploadFile.textContent =
            selectedFile.name + " · " + formatBytes(selectedFile.size);
      }
      if (uploadCancelButton) uploadCancelButton.hidden = false;

      // Every terminal outcome — success, refusal, a transport error, a
      // timeout, an abort — closes the progress box, brings the drop area,
      // the title field and the Publish button back, and hands the button
      // back to the file/title state it should be in. Leaving that to only
      // one of these (onerror alone, say) is what leaves the button dead
      // after a refusal and the page needing a reload. A refusal's own
      // showMessage() call (below) runs before this and marks the drop
      // area's error state while it is still hidden — harmless, since
      // finishUpload is what makes it visible again, framed and carrying
      // the message in the same slot the publisher was just watching.
      function finishUpload() {
        activeXhr = null;
        if (uploadCancelButton) uploadCancelButton.hidden = true;
        if (uploadBox) uploadBox.hidden = true;
        dropArea.hidden = false;
        if (fieldBlock) fieldBlock.hidden = false;
        publishButton.hidden = false;
        if (formCancel) formCancel.hidden = false;
        updatePublishButton();
      }

      xhr.upload.onprogress = function (progressEvent) {
        if (!progressEvent.lengthComputable || !uploadFill) return;
        var percent = Math.round(
          (progressEvent.loaded / progressEvent.total) * 100,
        );
        uploadFill.style.width = percent + "%";
        if (uploadPercent) uploadPercent.textContent = percent + "%";
      };

      // The request asked for application/json and the server answers JSON
      // for both a success and a refusal — there is no HTML branch to check
      // for here, and a check for one is exactly what would drop a refusal
      // silently (a `.zip` whose bytes are not a zip, a zip with no entry
      // file: both 2xx-or-not decided by the server, never pre-checkable by
      // this script).
      xhr.onload = function () {
        var response = null;
        try {
          response = JSON.parse(xhr.responseText);
        } catch {
          // fall through with response left null
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          if (response && response.location) {
            window.location.assign(response.location);
            return;
          }
        } else if (response && response.error) {
          showMessage(response.error);
        }

        finishUpload();
      };

      xhr.onerror = finishUpload;
      xhr.ontimeout = finishUpload;
      xhr.onabort = finishUpload;

      xhr.send(formData);
    });

    updatePublishButton();
  }

  // The entry-choice screen (docs/adr/0012-choose-a-zips-entry-page-when-it-is-ambiguous.md).
  // Returns immediately when the screen is not the one rendered, so every
  // other page stays untouched.
  function initEntryChoice() {
    var publishButton = document.querySelector("[data-entry-publish]");
    if (!publishButton) return;

    var radios = document.querySelectorAll('input[name="entry"]');

    function updatePublishButton() {
      var anyChecked = false;
      radios.forEach(function (radio) {
        if (radio.checked) anyChecked = true;
      });
      publishButton.disabled = !anyChecked;
      publishButton.textContent = anyChecked
        ? publishButton.getAttribute("data-label-ready")
        : publishButton.getAttribute("data-label-no-entry");
    }

    radios.forEach(function (radio) {
      radio.addEventListener("change", updatePublishButton);
    });
    updatePublishButton();

    var filterBlock = document.querySelector("[data-entry-filter]");
    if (!filterBlock) return;
    filterBlock.hidden = false;

    var filterInput = filterBlock.querySelector("[data-entry-filter-input]");
    var countSpan = filterBlock.querySelector("[data-entry-filter-count]");
    var noMatch = document.querySelector("[data-entry-no-match]");

    bindPathFilter({
      filterBlock: filterBlock,
      input: filterInput,
      countSpan: countSpan,
      noMatch: noMatch,
      radios: Array.prototype.slice.call(radios),
      rowFor: function (radio) {
        return radio.closest(".entry-row");
      },
    });
  }

  // The dashboard row's own upload — a new state onto an already-published
  // handout, from its "Upload a new state" menu item. Returns immediately
  // when the dashboard is not the page rendered.
  function initRowUpload() {
    var list = document.querySelector("[data-handout-list]");
    if (!list) return;

    var maxUploadBytes = Number(list.getAttribute("data-max-upload-bytes"));
    var allowedExtensions = [".zip", ".html", ".htm", ".pdf"];

    list.querySelectorAll("[data-handout-row]").forEach(function (row) {
      var uploadItem = row.querySelector("[data-row-upload]");
      var fileInput = row.querySelector("[data-row-file-input]");
      var box = row.querySelector("[data-row-upload-box]");
      var boxFile = row.querySelector("[data-row-upload-file]");
      var boxPercent = row.querySelector("[data-row-upload-percent]");
      var boxFill = row.querySelector("[data-row-upload-fill]");
      var stampEl = row.querySelector("[data-local-stamp]");
      if (!uploadItem || !fileInput) return;

      var showMessage = rowMessage(list, row);

      function extensionOf(name) {
        var match = /\.[a-z0-9]+$/i.exec(name);
        return match ? match[0].toLowerCase() : "";
      }

      uploadItem.addEventListener("click", function () {
        fileInput.click();
      });

      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = "";
        if (!file) return;

        showMessage("");

        if (file.size > maxUploadBytes) {
          showMessage(
            substitute(list.getAttribute("data-too-large"), {
              size: formatBytes(file.size),
              limit: formatBytes(maxUploadBytes),
            }),
          );
          return;
        }
        if (allowedExtensions.indexOf(extensionOf(file.name)) === -1) {
          showMessage(list.getAttribute("data-unsupported"));
          return;
        }

        uploadItem.disabled = true;
        box.hidden = false;
        boxFile.textContent = file.name + " · " + formatBytes(file.size);
        boxPercent.textContent = "0 %";
        boxFill.style.width = "0%";

        var xhr = new XMLHttpRequest();
        xhr.open("POST", row.getAttribute("data-upload-url"), true);
        xhr.setRequestHeader("Accept", "application/json");

        function finish() {
          uploadItem.disabled = false;
          box.hidden = true;
        }

        xhr.upload.onprogress = function (progressEvent) {
          if (!progressEvent.lengthComputable) return;
          var percent = Math.round(
            (progressEvent.loaded / progressEvent.total) * 100,
          );
          boxPercent.textContent = percent + " %";
          boxFill.style.width = percent + "%";
        };

        xhr.onload = function () {
          var response = null;
          try {
            response = JSON.parse(xhr.responseText);
          } catch {
            // fall through with response left null
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            if (response && response.location) {
              window.location.assign(response.location);
              return;
            }
            if (response && response.updatedAt && stampEl) {
              stampEl.setAttribute("datetime", response.updatedAt);
              stampEl.textContent = response.updatedAtText;
              applyLocalStamp(stampEl);
            }
          } else if (response && response.error) {
            showMessage(response.error);
          }

          finish();
        };

        xhr.onerror = finish;
        xhr.ontimeout = finish;
        xhr.onabort = finish;

        var formData = new FormData();
        formData.append("file", file);
        xhr.send(formData);
      });
    });
  }

  // The row's "change the entry page" panel (docs/adr/0021). Every word in
  // the panel's markup comes from a data-* attribute the view
  // wrote (docs/adr/0006); nothing here is an interface literal. Returns
  // immediately when the dashboard is not the page rendered.
  function initRowEntry() {
    var list = document.querySelector("[data-handout-list]");
    if (!list) return;

    var template = document.querySelector("[data-row-entry-template]");

    list.querySelectorAll("[data-handout-row]").forEach(function (row) {
      var panel = row.querySelector("[data-row-entry-panel]");
      var entryItem = row.querySelector("[data-row-entry-item]");
      if (!panel || !entryItem) return;

      var toggle = row.querySelector("[data-row-menu-toggle]");
      var entryUrl = row.getAttribute("data-entry-url");
      // "/handouts/<address>/entry" — the bare address, the same one the
      // design's own groupName/id scheme is built from (HandoutZeile.dc.html:
      // entryGroup: "entry-" + rowId).
      var address = entryUrl.split("/")[2];
      var group = "entry-" + address;

      var descriptionEl = panel.querySelector("[data-row-entry-description]");
      var filterBlock = panel.querySelector("[data-row-entry-filter]");
      var filterInput = filterBlock.querySelector(
        "[data-row-entry-filter-input]",
      );
      var filterCount = filterBlock.querySelector(
        "[data-row-entry-filter-count]",
      );
      var listEl = panel.querySelector("[data-row-entry-list]");
      var noMatch = listEl.querySelector("[data-row-entry-no-match]");
      var saveButton = panel.querySelector("[data-row-entry-save]");
      var cancelButton = panel.querySelector("[data-row-entry-cancel]");

      var showMessage = rowMessage(list, row);
      var currentEntry = null;

      // Bound once per row, not once per open: the panel is refetched and
      // rebuilt on every open (below), and rebinding the filter each time
      // would stack one more "input" listener per open, each still holding
      // its own now-detached radio list through its closure. buildRows()
      // hands the current list in through setRadios instead.
      var filterController = bindPathFilter({
        input: filterInput,
        countSpan: filterCount,
        noMatch: noMatch,
        radios: [],
        rowFor: function (radio) {
          return radio.closest(".handout-row-entry-row");
        },
      });

      function checkedRadio() {
        return panel.querySelector('input[name="' + group + '"]:checked');
      }

      // The save state rule, from the component: disabled while nothing is
      // chosen or the choice equals the current entry; recomputed on every
      // radio change and after every save attempt.
      function updateSaveState() {
        var checked = checkedRadio();
        var value = checked ? checked.value : null;
        var disabled = !value || value === currentEntry;
        saveButton.disabled = disabled;
        saveButton.textContent = saveButton.getAttribute(
          disabled ? "data-label-unchanged" : "data-label-ready",
        );
      }

      // Rebuilds the radio list from the page's one shared
      // [data-row-entry-template], cloned per candidate rather than
      // server-rendered per row — the amount of markup per row stays
      // constant regardless of how many pages the archive holds.
      function buildRows(candidates, entry) {
        listEl
          .querySelectorAll(".handout-row-entry-row")
          .forEach(function (el) {
            el.remove();
          });

        var radios = [];
        candidates.forEach(function (candidatePath, i) {
          var clone = template.content.firstElementChild.cloneNode(true);
          var input = clone.querySelector("input");
          var span = clone.querySelector("span");
          var id = group + "-" + i;
          input.name = group;
          input.id = id;
          input.value = candidatePath;
          input.checked = candidatePath === entry;
          clone.setAttribute("for", id);
          span.textContent = candidatePath;
          input.addEventListener("change", updateSaveState);
          listEl.insertBefore(clone, noMatch);
          radios.push(input);
        });

        // Reset in both branches: a candidate count that drops from >8 to
        // <=8 between two opens (the concurrent-upload case decision 2
        // exists for) must not leave a stale "No path contains this text."
        // sitting under a now fully shown list.
        filterInput.value = "";
        filterController.setRadios(radios);
        if (candidates.length > 8) {
          filterBlock.hidden = false;
          filterController.update();
        } else {
          filterBlock.hidden = true;
          noMatch.hidden = true;
        }

        return radios;
      }

      function closePanel() {
        panel.hidden = true;
        showMessage("");
        if (toggle) toggle.focus();
      }

      // Refetches on every open, so the list is what lies under the address
      // at the moment the question is put (docs/adr/0021) — never a copy
      // taken at render time.
      function openPanel() {
        showMessage("");
        var xhr = new XMLHttpRequest();
        xhr.open("GET", entryUrl, true);
        xhr.setRequestHeader("Accept", "application/json");
        xhr.onload = function () {
          var response = null;
          try {
            response = JSON.parse(xhr.responseText);
          } catch {
            // fall through with response left null
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            if (response && response.error) showMessage(response.error);
            return;
          }

          currentEntry = response.entry || null;
          descriptionEl.textContent = currentEntry
            ? substitute(descriptionEl.getAttribute("data-template-current"), {
                entry: currentEntry,
              })
            : descriptionEl.getAttribute("data-template-none");

          var radios = buildRows(response.candidates || [], currentEntry);
          updateSaveState();

          panel.hidden = false;
          var checked = radios.filter(function (radio) {
            return radio.checked;
          })[0];
          (checked || radios[0] || cancelButton).focus();
        };
        // A transport failure leaves the panel closed with nothing to
        // report — there is no response to read a sentence from.
        xhr.onerror = function () {};
        xhr.send();
      }

      entryItem.addEventListener("click", openPanel);
      cancelButton.addEventListener("click", closePanel);

      saveButton.addEventListener("click", function () {
        var checked = checkedRadio();
        if (!checked) return;
        var entry = checked.value;

        saveButton.disabled = true;
        var xhr = new XMLHttpRequest();
        xhr.open("POST", entryUrl, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("Accept", "application/json");
        xhr.onload = function () {
          var response = null;
          try {
            response = JSON.parse(xhr.responseText);
          } catch {
            // fall through with response left null
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            currentEntry = response.entry;
            closePanel();
            return;
          }
          // The choice is not lost: the panel stays open and the message
          // reports why the save was refused.
          if (response && response.error) showMessage(response.error);
          updateSaveState();
        };
        xhr.onerror = function () {
          updateSaveState();
        };
        xhr.send(JSON.stringify({ entry: entry }));
      });

      // Not in the design — a deliberate addition mirroring the row menu's
      // own Escape handler and initProfilePanel(), the other popovers in the
      // product.
      panel.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !panel.hidden) closePanel();
      });

      // The design's own state machine makes the row's panels mutually
      // exclusive, and a list derived before an upload is about to be
      // wrong — closing here rather than leaving a stale panel open under
      // a state the upload is about to replace.
      var fileInput = row.querySelector("[data-row-file-input]");
      if (fileInput) {
        fileInput.addEventListener("change", function () {
          if (!panel.hidden) {
            panel.hidden = true;
            showMessage("");
          }
        });
      }
    });
  }

  // The one delete dialog on the page (docs/adr/0024): every word in its
  // markup comes from a data-* attribute the view wrote or from the
  // server-rendered markup — no interface literal in this file.
  function initRowDelete() {
    var dialog = document.querySelector("[data-delete-dialog]");
    var items = document.querySelectorAll("[data-row-delete]");
    if (!dialog || items.length === 0) return;

    // No showModal(), no dialog — and then no dead menu item either.
    if (typeof dialog.showModal !== "function") {
      items.forEach(function (item) {
        item.hidden = true;
      });
      return;
    }

    var form = dialog.querySelector("[data-delete-dialog-form]");
    var titleEl = dialog.querySelector("[data-delete-dialog-title]");
    var addressEl = dialog.querySelector("[data-delete-dialog-address]");
    var cancel = dialog.querySelector("[data-delete-dialog-cancel]");
    var opener = null;

    items.forEach(function (item) {
      item.addEventListener("click", function () {
        form.setAttribute("action", item.getAttribute("data-delete-url"));
        titleEl.textContent = item.getAttribute("data-delete-title");
        addressEl.textContent = item.getAttribute("data-delete-address");
        var row = item.closest("[data-handout-row]");
        opener = row ? row.querySelector("[data-row-menu-toggle]") : null;
        dialog.showModal();
      });
    });

    cancel.addEventListener("click", function () {
      dialog.close();
    });

    // A closed dialog hands focus back to whatever had it — the menu item,
    // which is hidden again by then, so focus would land on the body. Put it
    // on the row's own ⋯ toggle instead. Covers Escape as well as Cancel:
    // showModal()'s own Escape fires "close" too.
    dialog.addEventListener("close", function () {
      if (opener) opener.focus();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initProfilePanel();
    initCopy();
    initCopyMessage();
    initProtectToggle();
    initDropArea();
    initEntryChoice();
    initRowMenu();
    initRowUpload();
    initRowEntry();
    initRowDelete();
    initLocalStamps();
  });
})();
