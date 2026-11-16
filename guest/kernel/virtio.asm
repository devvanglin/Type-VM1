# ---------------------------------------------------------------------------
# virtio-mmio block driver (modern virtio 1.0, single queue, polled)
# ---------------------------------------------------------------------------

# Initialise the device.  Returns a0 = 1 on success, 0 on failure.
virtio_init:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)

  li s0, VIRTIO_BASE
  lw t0, VIRTIO_MAGIC(s0)
  li t1, VIRTIO_MAGIC_VAL
  bne t0, t1, virtio_init_fail
  lw t0, VIRTIO_VERSION(s0)
  li t1, VIRTIO_VERSION_VAL
  bne t0, t1, virtio_init_fail
  lw t0, VIRTIO_DEVICE(s0)
  li t1, VIRTIO_ID_BLOCK
  bne t0, t1, virtio_init_fail

  # Reset, acknowledge, set driver.
  sw zero, VIRTIO_STATUS(s0)
  li t0, 1
  sw t0, VIRTIO_STATUS(s0)
  li t0, 3
  sw t0, VIRTIO_STATUS(s0)

  # Negotiate VIRTIO_F_VERSION_1 (feature bit 32).
  li t0, 1
  sw t0, VIRTIO_FEAT_SEL(s0)
  lw t0, VIRTIO_FEATURES(s0)
  andi t0, t0, 1
  beqz t0, virtio_init_fail
  sw t0, VIRTIO_DFEAT_HI(s0)
  sw zero, VIRTIO_DFEAT_LO(s0)
  li t0, 11
  sw t0, VIRTIO_STATUS(s0)          # ACKNOWLEDGE | DRIVER | FEATURES_OK

  # Queue 0: 8 descriptors.
  sw zero, VIRTIO_QSEL(s0)
  li t0, 8
  sw t0, VIRTIO_QNUM(s0)
  la t0, virtq_desc
  sw t0, VIRTIO_QDESC_LO(s0)
  sw zero, VIRTIO_QDESC_HI(s0)
  la t0, virtq_avail
  sw t0, VIRTIO_QAVAIL_LO(s0)
  sw zero, VIRTIO_QAVAIL_HI(s0)
  la t0, virtq_used
  sw t0, VIRTIO_QUSED_LO(s0)
  sw zero, VIRTIO_QUSED_HI(s0)
  li t0, 1
  sw t0, VIRTIO_QREADY(s0)
  li t0, 15
  sw t0, VIRTIO_STATUS(s0)          # DRIVER_OK

  # Disk capacity in 512-byte sectors.
  lw t0, VIRTIO_CONFIG(s0)
  la t1, disk_sectors
  sw t0, 0(t1)
  la t1, virtio_ok
  li t0, 1
  sw t0, 0(t1)

  # PLIC: give the virtio IRQ a priority and enable it for hart 0.
  li t0, 0x0c000004                 # priority of source 1
  li t1, 1
  sw t1, 0(t0)
  li t0, PLIC_ENABLE
  li t1, 2
  sw t1, 0(t0)
  li t0, PLIC_THRESHOLD
  sw zero, 0(t0)

  li a0, 1
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

virtio_init_fail:
  la t0, virtio_ok
  sw zero, 0(t0)
  li a0, 0
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

# Submit one block request.
#   a0 = 0 read / 1 write, a1 = sector, a2 = buffer
# Returns a0 = 0 on success, -1 on error.
virtio_request:
  addi sp, sp, -32
  sw ra, 28(sp)
  sw s0, 24(sp)
  sw s1, 20(sp)
  sw s2, 16(sp)
  mv s0, a0                  # type
  mv s1, a1                  # sector
  mv s2, a2                  # buffer

  # Request header.
  la t0, virtio_hdr
  sw s0, 0(t0)
  sw zero, 4(t0)
  sw s1, 8(t0)
  sw zero, 12(t0)

  # Descriptor chain: header -> data -> status.
  la t0, virtq_desc
  la t1, virtio_hdr
  sw t1, 0(t0)
  sw zero, 4(t0)
  li t1, 16
  sw t1, 8(t0)
  li t1, 1
  sh t1, 12(t0)              # VIRTQ_DESC_F_NEXT
  li t1, 1
  sh t1, 14(t0)              # next = 1

  sw s2, 16(t0)
  sw zero, 20(t0)
  li t1, 512
  sw t1, 24(t0)
  li t1, 1                   # NEXT
  bnez s0, virtio_desc_flags
  li t1, 3                   # NEXT | WRITE (device writes the buffer)
virtio_desc_flags:
  sh t1, 28(t0)
  li t1, 2
  sh t1, 30(t0)              # next = 2

  la t1, virtio_status
  sw t1, 32(t0)
  sw zero, 36(t0)
  li t1, 1
  sw t1, 40(t0)
  sh zero, 44(t0)
  sh zero, 46(t0)

  # Publish the buffer on the available ring.
  la t0, virtq_avail
  lhu t1, 2(t0)
  andi t2, t1, 7
  slli t2, t2, 1
  add t2, t2, t0
  sh zero, 4(t2)
  addi t1, t1, 1
  sh t1, 2(t0)

  # Remember how many completions we expect, then notify.
  la t0, virtio_used_expect
  lw t1, 0(t0)
  addi t1, t1, 1
  sw t1, 0(t0)
  li t0, VIRTIO_BASE
  li t2, 1
  sw t2, VIRTIO_QNOTIFY(t0)

  # Wait for the used ring to advance.
  la t2, virtq_used
virtio_wait:
  lhu t3, 2(t2)
  bne t3, t1, virtio_wait

  # Check the device status byte.
  la t0, virtio_status
  lbu t2, 0(t0)
  bnez t2, virtio_request_fail

  # Acknowledge the interrupt (keeps the PLIC line quiet).
  li t0, VIRTIO_BASE
  lw t1, VIRTIO_ISTATUS(t0)
  sw t1, VIRTIO_IACK(t0)

  li a0, 0
  lw s2, 16(sp)
  lw s1, 20(sp)
  lw s0, 24(sp)
  lw ra, 28(sp)
  addi sp, sp, 32
  ret

virtio_request_fail:
  li a0, -1
  lw s2, 16(sp)
  lw s1, 20(sp)
  lw s0, 24(sp)
  lw ra, 28(sp)
  addi sp, sp, 32
  ret

# a0 = sector, a1 = buffer (512 bytes)
virtio_read512:
  li t0, 0
  mv t2, a1
  mv a1, a0
  mv a2, t2
  li a0, 0
  j virtio_request

# a0 = sector, a1 = buffer (512 bytes)
virtio_write512:
  li t0, 1
  mv t2, a1
  mv a1, a0
  mv a2, t2
  li a0, 1
  j virtio_request
