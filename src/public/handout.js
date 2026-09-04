(function () {
  "use strict";

  // Theme switch — the one behaviour with no no-JS equivalent.
  function initTheme() {
    var buttons = document.querySelectorAll("[data-theme-button]");
    if (buttons.length === 0) return;

    function currentTheme() {
      try {
        return localStorage.getItem("handout-theme") || "system";
      } catch (e) {
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
      } catch (e) {
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
      if (!panel.hidden && !panel.contains(event.target) && event.target !== toggle) {
        close();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !panel.hidden) close();
    });
  }

  // Clipboard copy.
  function initCopy() {
    var button = document.querySelector("[data-copy-button]");
    if (!button) return;

    function showConfirmation(label) {
      var original = button.textContent;
      button.textContent = label;
      setTimeout(function () {
        button.textContent = original;
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
          // permission); silence here would be exactly the "copied twice,
          // pasted into nothing" failure the confirmation exists to prevent.
          showConfirmation(failedLabel);
        },
      );
    });
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
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match;
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
    var publishButton = form.querySelector("[data-publish-button]");
    var uploadBox = form.querySelector("[data-upload-box]");
    var uploadFile = uploadBox ? uploadBox.querySelector("[data-upload-file]") : null;
    var uploadPercent = uploadBox ? uploadBox.querySelector("[data-upload-percent]") : null;
    var uploadFill = uploadBox ? uploadBox.querySelector("[data-upload-fill]") : null;

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
        publishButton.textContent = publishButton.getAttribute("data-label-no-file");
      } else if (!titleInput.value.trim()) {
        publishButton.disabled = true;
        publishButton.textContent = publishButton.getAttribute("data-label-no-title");
      } else {
        publishButton.disabled = false;
        publishButton.textContent = publishButton.getAttribute("data-label-ready");
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
      if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
        acceptFile(event.dataTransfer.files[0]);
      }
    });

    titleInput.addEventListener("input", updatePublishButton);

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
        if (uploadFile) uploadFile.textContent = selectedFile.name + " · " + formatBytes(selectedFile.size);
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
        var percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
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
        } catch (e) {
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

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initProfilePanel();
    initCopy();
    initDropArea();
  });
})();
