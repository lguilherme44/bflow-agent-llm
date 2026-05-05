import { execSync } from 'node:child_process';
import os from 'node:os';

export interface SystemStats {
  cpu: {
    load?: string;
    model: string;
    cores: number;
  };
  memory: {
    totalGB: string;
    usedGB: string;
    percent: string;
  };
  gpu?: {
    name: string;
    utilization: string;
    vramUsed: string;
    vramTotal: string;
    vramPercent: string;
  };
}

export function getSystemStats(): SystemStats {
  // Memory
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  const stats: SystemStats = {
    cpu: {
      model: os.cpus()[0].model,
      cores: os.cpus().length,
    },
    memory: {
      totalGB: (totalMem / 1024 / 1024 / 1024).toFixed(2),
      usedGB: (usedMem / 1024 / 1024 / 1024).toFixed(2),
      percent: ((usedMem / totalMem) * 100).toFixed(1),
    }
  };

  // CPU Load (Windows specific for now as requested by OS context)
  try {
    if (process.platform === 'win32') {
      const load = execSync('powershell -Command "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty LoadPercentage"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (load) stats.cpu.load = load.trim() + '%';
    } else {
      stats.cpu.load = os.loadavg()[0].toFixed(1) + ' (load avg)';
    }
  } catch {
    // Ignore if powershell or wmic fails
  }

  // GPU Stats
  try {
    const gpuInfo = execSync('nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const [name, util, used, total] = gpuInfo.split(',').map(s => s.trim());
    if (name && util && used && total) {
      stats.gpu = {
        name,
        utilization: util + '%',
        vramUsed: (parseInt(used) / 1024).toFixed(2) + ' GB',
        vramTotal: (parseInt(total) / 1024).toFixed(2) + ' GB',
        vramPercent: ((parseInt(used) / parseInt(total)) * 100).toFixed(1) + '%',
      };
    }
  } catch {
    // No NVIDIA GPU or nvidia-smi not found
  }

  return stats;
}
