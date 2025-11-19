import logging
import os
from logging.handlers import RotatingFileHandler

class NumberBeforeExtensionRotatingFileHandler(RotatingFileHandler):
    """RotatingFileHandler variant that names backups as app.1.log instead of app.log.1

    Default RotatingFileHandler produces: base.log, base.log.1, base.log.2 ...
    We transform that to: base.1.log, base.2.log ... for easier globbing with app.*.log.
    """

    def rotate(self, source: str, dest: str) -> None:  # pragma: no cover (simple adaptation)
        # dest will be something like /path/app.log.1
        directory = os.path.dirname(dest)
        filename = os.path.basename(dest)  # app.log.1
        parts = filename.rsplit('.', 2)   # ['app', 'log', '1']
        if len(parts) == 3 and parts[2].isdigit():
            stem, ext_without_dot, index = parts
            new_filename = f"{stem}.{index}.{ext_without_dot}"  # app.1.log
            new_dest = os.path.join(directory, new_filename)
        else:
            new_dest = dest
        super().rotate(source, new_dest)

    def getFilesToDelete(self):  # pragma: no cover (mirrors base logic for new naming)
        # Collect existing rotated files following app.N.log pattern
        directory = os.path.dirname(self.baseFilename)
        base = os.path.basename(self.baseFilename)  # app.log
        stem, ext = os.path.splitext(base)          # ('app', '.log')
        candidates = []
        for i in range(1, self.backupCount + 1):
            path = os.path.join(directory, f"{stem}.{i}{ext}")
            if os.path.exists(path):
                candidates.append(path)
        # If we haven't yet reached backupCount, nothing to delete
        if len(candidates) <= self.backupCount:
            return []
        # Sort by index; delete oldest beyond backupCount
        return sorted(candidates)[:-self.backupCount]

def get_logger():
    logger = logging.getLogger("stt-server")
    if logger.handlers:  # Avoid duplicate handlers if called multiple times
        return logger

    logger.setLevel(logging.INFO)

    # Base file remains app.log; backups become app.1.log, app.2.log, etc.
    handler = NumberBeforeExtensionRotatingFileHandler(
        "app.log", maxBytes=10000, backupCount=5
    )
    handler.setLevel(logging.INFO)

    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    handler.setFormatter(formatter)

    logger.addHandler(handler)

    return logger