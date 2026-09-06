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

    form.addEventListener("submit", function (event) {
      if (!window.XMLHttpRequest || !selectedFile) return;
      event.preventDefault();

      var formData = new FormData(form);
      var xhr = new XMLHttpRequest();
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
      if (uploadBox) {
        uploadBox.hidden = false;
        if (uploadFile)
          uploadFile.textContent =
            selectedFile.name + " · " + formatBytes(selectedFile.size);
      }

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
        if (uploadBox) uploadBox.hidden = true;
        dropArea.hidden = false;
        if (fieldBlock) fieldBlock.hidden = false;
        publishButton.hidden = false;
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
    var total = radios.length;

    function updateFilter() {
      var needle = filterInput.value.trim().toLowerCase();
      var shown = 0;
      var pinned = false;

      radios.forEach(function (radio) {
        var row = radio.closest(".entry-row");
        var matches =
          !needle || row.textContent.toLowerCase().indexOf(needle) !== -1;
        // The selected row is never hidden and never moved (docs/adr/0012,
        // D8): the design system's own rule is "filtering never discards the
        // selection", so a checked radio stays put and stays visible even
        // when the needle would otherwise exclude it — the component's own
        // implementation (which pins it back to the top of the list) is not
        // followed here, only its stated rule.
        if (radio.checked && !matches) {
          pinned = true;
          row.hidden = false;
          return;
        }
        row.hidden = !matches;
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

    filterInput.addEventListener("input", updateFilter);
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initProfilePanel();
    initCopy();
    initCopyMessage();
    initProtectToggle();
    initDropArea();
    initEntryChoice();
  });
})();
