"""Stub torch for CPU tests of the entrypoint: reports one CUDA device so preflight's GPU check passes behind a stub
nvidia-smi. Never installed in the image."""
__version__ = "2.8.0+cu128"


class version:  # noqa: N801
    cuda = "12.8"


class cuda:  # noqa: N801
    @staticmethod
    def is_available():
        return True

    @staticmethod
    def get_device_capability(_i=0):
        return (8, 9)

    @staticmethod
    def mem_get_info(_i=0):
        return (47 * 2**30, 48 * 2**30)
