//! Running the runners the plane hands out: installing their builds,
//! running them on this machine (`host`) or in VMs (`vm_host`), and
//! supervising them from start to reported exit (`supervisor`).
pub mod errors;
pub mod host;
pub mod install;
pub mod process;
pub mod supervisor;
pub mod vm_host;
