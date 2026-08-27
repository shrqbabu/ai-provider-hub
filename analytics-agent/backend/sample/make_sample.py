import numpy as np, pandas as pd, os
rng = np.random.default_rng(7)
n = 6000
start = pd.Timestamp("2023-01-01")
dates = start + pd.to_timedelta(rng.integers(0, 1000, n), unit="D")
cats = ["Electronics","Apparel","Home & Kitchen","Sports","Beauty"]
regions = ["North","South","East","West"]
channels = ["Online","Retail","Partner"]
prods = [f"SKU-{i:03d}" for i in range(1, 61)]
custs = [f"CUST-{i:04d}" for i in range(1, 900)]
cat = rng.choice(cats, n, p=[.3,.25,.2,.15,.1])
qty = rng.integers(1, 12, n)
price = np.round(rng.gamma(4, 25, n) + 5, 2)
seasonal = 1 + 0.25*np.sin((dates.dayofyear/365)*2*np.pi)
trend = 1 + (dates - start).days/1000*0.4
rev = np.round(qty*price*seasonal*trend, 2)
df = pd.DataFrame({
 "order_id":[f"ORD-{i:06d}" for i in range(1,n+1)],
 "order_date":dates.strftime("%Y-%m-%d"),
 "customer_id":rng.choice(custs,n),
 "product_id":rng.choice(prods,n),
 "category":cat,
 "region":rng.choice(regions,n),
 "channel":rng.choice(channels,n),
 "quantity":qty,"unit_price":price,
 "revenue":rev,
 "cost":np.round(rev*rng.uniform(.55,.8,n),2),
 "discount":np.round(rev*rng.uniform(0,.15,n),2),
})
df.loc[rng.choice(n, 60, replace=False), "region"] = None
os.makedirs("sample", exist_ok=True)
df.to_csv("sample/retail_sales.csv", index=False)
print(df.shape, df.revenue.sum())
