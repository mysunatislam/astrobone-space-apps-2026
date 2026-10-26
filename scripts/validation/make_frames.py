import csv, numpy as np, os, collections
R = '/home/user/data/rehab24'
rows = list(csv.DictReader(open(f'{R}/Segmentation.csv'), delimiter=';'))
by = collections.defaultdict(list)
for x in rows:
    if x['exercise_id'] in ('5', '6') and x['mocap_erroneous'] == '0':
        by[(x['exercise_id'], x['video_id'])].append(x)
jobs = []
for (ex, vid), reps in sorted(by.items()):
    stride = 6 if ex == '6' else 10
    n = len(np.load(f'{R}/Ex{ex}/{vid}-30fps.npy', mmap_mode='r'))
    fr = sorted({f for r in reps for f in range(int(r['first_frame']), min(int(r['last_frame']), n - 1) + 1, stride)})
    np.save(f'/home/user/data/pose_out/frames_Ex{ex}_{vid}.npy', np.array(fr))
    for cam, suffix in (('c17', 'Camera17-30fps'), ('c18', 'Camera18-30fps-transposed')):
        jobs.append(f'Ex{ex} {vid} {cam} {R}/vids/Ex{ex}/{vid}-{suffix}.mp4 {len(fr)}')
open('/home/user/data/pose_out/jobs.txt', 'w').write('\n'.join(jobs) + '\n')
print(len(jobs), 'jobs', sum(int(j.split()[-1]) for j in jobs), 'frames')
