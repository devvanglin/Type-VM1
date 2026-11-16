Type-VM1 demo disk
=================

This disk is a tiny read-only filesystem called TVFS.  It is served by a
virtio-mmio block device emulated by the host and read by the guest kernel's
virtio-blk driver.

Try these commands in the shell:

  ls                     list this directory
  cat README.TXT         show this file
  cat NOTES.TXT          system call ABI and device addresses
  run HELLO              print a greeting from user mode
  run FIB                fibonacci through ecall syscalls
  run CRASH              trigger a fault, watch the kernel catch it
  run SYSINFO            read the virtual clock from user mode
  test                   run the kernel self test
  info                   show the platform description
  date                   read the host clock through the RTC
  irq                    interrupt controller state
  sleep 250              sleep 250 virtual milliseconds

Everything you see is emulated: instruction by instruction, there is no
hardware behind it.
