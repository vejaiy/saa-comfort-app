/* ============================================================
   SAA Comfort Air LLC — employee area access gate
   NOTE: this is a simple front-door lock, not real security.
   The password below lives in this file in plain text, so anyone
   who views the page source can read it. It is meant to keep
   casual visitors out of your pricing pages, not to protect
   sensitive data on a public server. Don't put anything in the
   employee pages you wouldn't want a determined visitor to see.

   To change the password: edit the line below and save the file.
   ============================================================ */
const EMPLOYEE_PASSWORD = "SAAcomfort2026";

function saaLogin(pw) {
  if (pw === EMPLOYEE_PASSWORD) {
    sessionStorage.setItem("saa_emp_auth", "1");
    return true;
  }
  return false;
}

function saaRequireAuth() {
  if (sessionStorage.getItem("saa_emp_auth") !== "1") {
    window.location.href = "login.html";
  }
}

function saaLogout() {
  sessionStorage.removeItem("saa_emp_auth");
  window.location.href = "login.html";
}

function saaIsAuthed() {
  return sessionStorage.getItem("saa_emp_auth") === "1";
}
